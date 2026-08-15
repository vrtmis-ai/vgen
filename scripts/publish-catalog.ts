// Seed the catalog into Postgres.
//
// This used to write `catalog_versions` + `models`, a pair of app-only tables
// holding one JSON document per family. Those are gone (0015). The catalog now
// lives in the tables the rest of the schema already routes and prices through:
//
//   providers            one row, KIE
//   provider_models      one row per variant — 44 of them
//   feature_model_routes variant -> the feature it serves
//
// Which means a job's provider_model_id, its feature_id and its price all point
// at rows that exist, instead of at a JSON blob nothing else in the database
// could join to.
//
// Idempotent by construction: re-running with an unchanged catalog performs no
// writes at all. That is not politeness — `provider_models` has an updated_at
// trigger and the served catalog version is derived from it, so an unconditional
// upsert would hand every customer a new catalog version every time this ran.
//
// Run: pnpm catalog:publish   (needs DATABASE_URL)

import { config } from "dotenv";
import postgres from "postgres";
import { CatalogSnapshotSchema } from "../src/runtime/contracts/catalog";
import { FAMILIES, type Family, type Variant } from "../src/data/models";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish the catalog");

// Parse before connecting. A catalog that would not survive being read back is
// not worth writing, and finding that out after a partial write is worse.
CatalogSnapshotSchema.parse({ version: "candidate", publishedAt: Date.now(), families: FAMILIES });

const PROVIDER = {
  code: "kie",
  name: "KIE",
  baseUrl: "https://api.kie.ai",
  creditUnitName: "credit",
} as const;

/**
 * Everything a screen needs that the columns do not carry.
 *
 * The family repeats on every one of its variants' rows. That is redundant and
 * deliberate: `provider_models` has no family table to point at, this seeder is
 * the only writer, and the alternative was a second table whose rows could
 * disagree with these. The repository reads the family off the first row of
 * each group.
 *
 * The two order fields exist because the studio screens are ordered lists and
 * the database is a set. Without them the catalog would come back sorted by
 * whatever the index felt like, and the model switcher would silently reshuffle.
 */
interface Capabilities {
  familyOrder: number;
  variantOrder: number;
  family: Omit<Family, "variants">;
  variant: Variant;
}

/** provider_models.modality, taken from the feature rather than the family. */
const MODALITY_BY_FEATURE: Record<string, string> = {
  image_generate: "image",
  image_edit: "image",
  video_generate: "video",
  image_to_video: "video",
  video_edit: "video",
  speech_generate: "audio",
  chat: "text",
};

function capabilitiesFor(family: Family, familyOrder: number, variant: Variant, variantOrder: number): Capabilities {
  const { variants, ...presentation } = family;
  // Round-tripped through JSON here rather than at the driver, so that absent
  // optionals are dropped now and `refs: null` — which means "this variant has
  // no slots" as opposed to "inherit the family's" — is preserved.
  return JSON.parse(JSON.stringify({ familyOrder, variantOrder, family: presentation, variant })) as Capabilities;
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    const [provider] = await tx<{ id: string }[]>`
      insert into providers (code, name, base_url, credit_unit_name, is_active)
      values (${PROVIDER.code}, ${PROVIDER.name}, ${PROVIDER.baseUrl}, ${PROVIDER.creditUnitName}, true)
      on conflict (code) do update set
        name = excluded.name,
        base_url = excluded.base_url,
        is_active = true
      returning id
    `;
    if (!provider) throw new Error("provider upsert returned no row");

    const featureRows = await tx<{ id: string; code: string }[]>`select id, code from features`;
    const featureIdByCode = new Map(featureRows.map((row) => [row.code, row.id]));

    // check-combos.ts audits this too, but it reads the migration files while
    // this reads the database, and only one of those is the thing being written
    // to. A drifted database should stop the seeder, not half-fill it.
    const unknown = FAMILIES.flatMap((family) =>
      family.variants.filter((v) => !featureIdByCode.has(v.featureCode)).map((v) => `${v.id} -> ${v.featureCode}`),
    );
    if (unknown.length) {
      throw new Error(`these variants name a feature this database has no row for:\n  ${unknown.join("\n  ")}\nRun the migrations first.`);
    }

    /**
     * One default route per feature, and the schema enforces it — there is a
     * unique index on (feature_id) where is_default and is_active. So this
     * cannot be "the first variant of each family": nine image families would
     * claim the same default and the ninth insert would fail.
     *
     * First variant in catalog order wins. The app always names a variant, so
     * this only decides what an unrouted request gets, and catalog order is
     * already the order the screens present as most-recommended-first.
     */
    const defaultVariantByFeature = new Map<string, string>();
    for (const family of FAMILIES) {
      for (const variant of family.variants) {
        if (!defaultVariantByFeature.has(variant.featureCode)) defaultVariantByFeature.set(variant.featureCode, variant.id);
      }
    }

    const liveModelIds: string[] = [];
    const defaultRouteIds: [feature: string, model: string][] = [];
    let written = 0;

    for (const [familyOrder, family] of FAMILIES.entries()) {
      for (const [variantOrder, variant] of family.variants.entries()) {
        const featureId = featureIdByCode.get(variant.featureCode) as string;
        const capabilities = capabilitiesFor(family, familyOrder, variant, variantOrder);

        const [model] = await tx<{ id: string; changed: boolean }[]>`
          insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
          values (
            ${provider.id},
            ${variant.model},
            ${`${family.name} ${variant.label}`},
            ${MODALITY_BY_FEATURE[variant.featureCode] as string},
            ${family.id},
            ${tx.json(capabilities as unknown as Parameters<typeof tx.json>[0])},
            true
          )
          on conflict (provider_id, external_model_id) do update set
            name = excluded.name,
            modality = excluded.modality,
            family = excluded.family,
            capabilities = excluded.capabilities,
            is_active = true,
            deprecated_at = null
          where
            provider_models.name is distinct from excluded.name
            or provider_models.modality is distinct from excluded.modality
            or provider_models.family is distinct from excluded.family
            or provider_models.capabilities is distinct from excluded.capabilities
            or provider_models.is_active is distinct from true
          returning id, true as changed
        `;

        // The WHERE clause above suppresses the UPDATE when nothing differs,
        // and a suppressed ON CONFLICT DO UPDATE returns no row at all. That is
        // the no-op case, not a failure — read the id back.
        const modelId =
          model?.id ??
          (
            await tx<{ id: string }[]>`
              select id from provider_models
              where provider_id = ${provider.id} and external_model_id = ${variant.model}
            `
          )[0]?.id;
        if (!modelId) throw new Error(`provider_models upsert lost ${variant.id}`);
        if (model) written++;
        liveModelIds.push(modelId);

        // is_default is deliberately not in the update list. It is settled
        // after the loop, because clearing and setting it here would let two
        // routes claim one feature mid-transaction and the unique index that
        // guarantees a feature has one default is checked per statement.
        await tx`
          insert into feature_model_routes (feature_id, provider_model_id, priority, is_default, is_active)
          values (${featureId}, ${modelId}, ${(familyOrder + 1) * 100 + variantOrder}, false, true)
          on conflict (feature_id, provider_model_id) do update set
            priority = excluded.priority,
            is_active = true
          where
            feature_model_routes.priority is distinct from excluded.priority
            or feature_model_routes.is_active is distinct from true
        `;

        if (defaultVariantByFeature.get(variant.featureCode) === variant.id) defaultRouteIds.push([featureId, modelId]);
      }
    }

    // Clear before set, never the other way round: one statement each, both
    // no-ops when the defaults are already right.
    const defaultModelIds = defaultRouteIds.map(([, modelId]) => modelId);
    await tx`
      update feature_model_routes set is_default = false
      where is_default and not (provider_model_id = any(${defaultModelIds}::uuid[]))
    `;
    await tx`
      update feature_model_routes set is_default = true
      where not is_default and provider_model_id = any(${defaultModelIds}::uuid[])
    `;

    // A variant deleted from models.ts has to stop being sold. Deactivated
    // rather than deleted: jobs, quotes and prices reference these rows, and a
    // model that is no longer on sale is still a model somebody bought.
    const retired = await tx<{ id: string }[]>`
      update provider_models
      set is_active = false, deprecated_at = coalesce(deprecated_at, now())
      where provider_id = ${provider.id} and is_active and not (id = any(${liveModelIds}::uuid[]))
      returning id
    `;
    if (retired.length) {
      await tx`
        update feature_model_routes set is_active = false
        where is_active and provider_model_id = any(${retired.map((row) => row.id)}::uuid[])
      `;
    }

    return { written, retired: retired.length, total: liveModelIds.length };
  });

  const families = FAMILIES.length;
  if (summary.written === 0 && summary.retired === 0) {
    console.log(`catalog already current: ${summary.total} models across ${families} families, nothing written`);
  } else {
    console.log(`published ${summary.total} models across ${families} families (${summary.written} written, ${summary.retired} retired)`);
  }
} finally {
  await sql.end();
}
