import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCatalogRepository } from "./catalogRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * The catalog is no longer a table of JSON documents; it is provider_models
 * grouped by `family`. So these tests write the rows the seeder writes, which
 * means they also pin the shape the seeder has to keep producing.
 */
const familyPresentation = (id: string, name: string) => ({
  id,
  name,
  vendor: "DEEV Test",
  kind: "image" as const,
  minTier: 1 as const,
  blurb: `${name} description`,
  grad: "linear-gradient(135deg,#111,#333)",
  controls: [],
});

const capabilities = (family: string, familyOrder: number, variantOrder: number, label: string) => ({
  familyOrder,
  variantOrder,
  family: familyPresentation(family, family.toUpperCase()),
  variant: { id: `${family}-${label}`, model: `${family}/${label}`, featureCode: "image_generate", label },
});

async function seedProvider(tx: Sql, code = "test-provider"): Promise<string> {
  const [provider] = await tx<{ id: string }[]>`
    insert into providers (code, name) values (${code}, ${code}) returning id
  `;
  return provider!.id;
}

async function seedModel(
  tx: Sql,
  providerId: string,
  family: string,
  familyOrder: number,
  variantOrder: number,
  label: string,
  active = true,
): Promise<void> {
  await tx`
    insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
    values (
      ${providerId},
      ${`${family}/${label}`},
      ${`${family} ${label}`},
      'image',
      ${family},
      ${tx.json(capabilities(family, familyOrder, variantOrder, label))},
      ${active}
    )
  `;
}

/** The provider_models row id for a seeded variant. */
async function modelIdOf(tx: Sql, variantId: string): Promise<string> {
  const [row] = await tx<{ id: string }[]>`
    select id from provider_models where capabilities -> 'variant' ->> 'id' = ${variantId} limit 1
  `;
  if (!row) throw new Error(`no seeded model for variant ${variantId}`);
  return row.id;
}

/**
 * A grant on a seeded variant, served by a second provider.
 *
 * The serving row is a real row on a real second provider rather than a stub,
 * because that is what the derivation joins through — and the check that a dead
 * provider withdraws the offer needs a provider it can switch off. Returns that
 * provider's id so a test can do exactly that.
 */
async function grant(
  tx: Sql,
  variantId: string,
  options: { dailyCap: number | null; minTier: number; covers: Record<string, string[]> | null },
): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const servingProviderId = await seedProvider(tx, `serving-${suffix}`);
  const [serving] = await tx<{ id: string }[]>`
    insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
    values (${servingProviderId}, ${`serving/${suffix}`}, 'serving row', 'image', 'serving',
            ${tx.json({ serves: variantId, billing: "subscription" })}, true)
    returning id
  `;
  const [feature] = await tx<{ id: string }[]>`select id from features where code = 'image_generate' limit 1`;
  await tx`
    insert into unlimited_entitlements (catalog_model_id, serving_model_id, feature_id, min_tier, daily_cap, covers, is_active)
    values (${await modelIdOf(tx, variantId)}, ${serving!.id}, ${feature?.id ?? null},
            ${options.minTier}, ${options.dailyCap}, ${options.covers === null ? null : tx.json(options.covers)}, true)
  `;
  return servingProviderId;
}

describe("Postgres catalog repository", () => {
  it("returns the bootstrap snapshot when no model is on sale", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;

      await expect(new PostgresCatalogRepository(tx).list()).resolves.toEqual({
        version: "bootstrap-v1",
        publishedAt: 0,
        families: [],
      });
    });
  });

  it("groups variants into families and keeps catalog order", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const providerId = await seedProvider(tx);

      // Inserted out of order on purpose: the snapshot must follow the order
      // fields, not the insertion order and not the id.
      await seedModel(tx, providerId, "beta", 1, 1, "fast");
      await seedModel(tx, providerId, "alpha", 0, 1, "lite");
      await seedModel(tx, providerId, "beta", 1, 0, "pro");
      await seedModel(tx, providerId, "alpha", 0, 0, "ultra");

      const snapshot = await new PostgresCatalogRepository(tx).list();

      expect(snapshot.families.map((family) => family.id)).toEqual(["alpha", "beta"]);
      expect(snapshot.families.map((family) => family.variants.map((variant) => variant.label))).toEqual([
        ["ultra", "lite"],
        ["pro", "fast"],
      ]);
      expect(snapshot.families[0]?.name).toBe("ALPHA");
      expect(snapshot.families[0]?.variants[0]?.featureCode).toBe("image_generate");
    });
  });

  it("leaves out a retired model, and a whole provider that is switched off", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const live = await seedProvider(tx, "live-provider");
      const dark = await seedProvider(tx, "dark-provider");
      await tx`update providers set is_active = false where id = ${dark}`;

      await seedModel(tx, live, "alpha", 0, 0, "ultra");
      await seedModel(tx, live, "alpha", 0, 1, "retired", false);
      await seedModel(tx, dark, "omega", 1, 0, "hidden");

      const snapshot = await new PostgresCatalogRepository(tx).list();

      expect(snapshot.families.map((family) => family.id)).toEqual(["alpha"]);
      expect(snapshot.families[0]?.variants.map((variant) => variant.label)).toEqual(["ultra"]);
    });
  });

  it("versions the snapshot by the newest model, so an edit invalidates it", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const providerId = await seedProvider(tx);
      await seedModel(tx, providerId, "alpha", 0, 0, "ultra");
      await seedModel(tx, providerId, "alpha", 0, 1, "lite");

      // Written at INSERT rather than by an UPDATE: provider_models has a
      // BEFORE UPDATE trigger that stamps updated_at with now(), and now() does
      // not advance inside a transaction — an update here would set both rows
      // to the same instant and prove nothing.
      const [stale] = await tx<{ updated_at: Date }[]>`
        update provider_models set updated_at = updated_at
        where external_model_id = 'alpha/ultra' returning updated_at
      `;
      await tx`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active, updated_at)
        values (
          ${providerId}, 'alpha/newest', 'alpha newest', 'image', 'alpha',
          ${tx.json(capabilities("alpha", 0, 2, "newest"))}, true, ${new Date(stale!.updated_at.getTime() + 3_600_000)}
        )
      `;

      const snapshot = await new PostgresCatalogRepository(tx).list();

      expect(snapshot.publishedAt).toBe(stale!.updated_at.getTime() + 3_600_000);
      expect(snapshot.version).toBe(`catalog-${snapshot.publishedAt}`);
    });
  });
  /**
   * The memo, and the case that makes its fingerprint more than a timestamp.
   *
   * Switching a provider off removes its models from the shop without touching
   * `provider_models.updated_at` at all — the trigger is on that table and the
   * write was to `providers`. A cache keyed on the newest model timestamp would
   * therefore keep serving a retired provider's models until something
   * unrelated happened to be edited. Which is a shop selling what it cannot run.
   */
  it("stops offering a provider's models the moment the provider is switched off", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const live = await seedProvider(tx, "live-provider");
      const dark = await seedProvider(tx, "dark-provider");
      await seedModel(tx, live, "alpha", 0, 0, "ultra");
      await seedModel(tx, dark, "omega", 1, 0, "hidden");

      // One repository across both calls, so the second one is served from the
      // memo unless something invalidates it.
      const catalog = new PostgresCatalogRepository(tx);
      expect((await catalog.list()).families.map((family) => family.id)).toEqual(["alpha", "omega"]);

      await tx`update providers set is_active = false where id = ${dark}`;

      expect((await catalog.list()).families.map((family) => family.id)).toEqual(["alpha"]);
    });
  });

  it("serves the same document twice without rebuilding it", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const providerId = await seedProvider(tx);
      await seedModel(tx, providerId, "alpha", 0, 0, "ultra");

      const catalog = new PostgresCatalogRepository(tx);
      const first = await catalog.list();
      const second = await catalog.list();

      // Identity, not equality: a rebuilt snapshot would be a new object with
      // the same contents, and `toEqual` could not tell the two apart.
      expect(second).toBe(first);
    });
  });

  // The seeder no longer puts the supplier's id in `capabilities`, but rows
  // written before that change still do, and a stale row must not be a leak.
  // Nothing strips these by hand: CatalogCapabilitiesSchema no longer declares
  // them, and Zod drops what it does not declare. The guarantee is therefore
  // "the contract is the filter", which is worth pinning — the day somebody adds
  // `.passthrough()` for an unrelated reason, this fails.
  it("never hands the customer the supplier's own model id, even from an old row", async () => {
    await inRollback(sql, async (tx) => {
      await tx`update provider_models set is_active = false where is_active`;
      const providerId = await seedProvider(tx);
      const base = capabilities("alpha", 0, 0, "ultra");
      const legacy = {
        ...base,
        variant: { ...base.variant, model: "acme-labs/seedance-2-fast", modelWithRefs: "acme-labs/seedance-2-fast-image-to-video" },
      };

      await tx`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
        values (${providerId}, 'alpha/ultra', 'alpha ultra', 'image', 'alpha', ${tx.json(legacy)}, true)
      `;

      const snapshot = await new PostgresCatalogRepository(tx).list();
      const variant = snapshot.families[0]?.variants[0] as Record<string, unknown> | undefined;

      expect(variant?.["label"]).toBe("ultra");
      expect(variant).not.toHaveProperty("model");
      expect(variant).not.toHaveProperty("modelWithRefs");
      expect(JSON.stringify(snapshot)).not.toMatch(/acme-labs/i);
    });
  });

  /**
   * The pipe is published, and it is published from the row that authorises it.
   *
   * `unlimited` is derived at build time from `unlimited_entitlements` rather
   * than seeded into `capabilities`. That is the whole design: a copy in the
   * blob would be a second place for the answer to live, and the two would
   * disagree the first time a grant was retired — the shop would go on
   * advertising a free pipe the quote path had already stopped granting.
   */
  it("publishes the unlimited pipe from the grant, and only on the granted variant", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-grant-${Math.random().toString(36).slice(2, 8)}`);
      await seedModel(tx, providerId, "granted", 1, 1, "pro");
      await seedModel(tx, providerId, "granted", 1, 2, "lite");
      await grant(tx, "granted-pro", { dailyCap: 50, minTier: 3, covers: { resolution: ["1K", "2K"] } });

      const snapshot = await new PostgresCatalogRepository(tx).list();
      const family = snapshot.families.find((candidate) => candidate.id === "granted");
      const pro = family?.variants.find((variant) => variant.id === "granted-pro");
      const lite = family?.variants.find((variant) => variant.id === "granted-lite");

      expect(pro?.unlimited).toEqual({ dailyCap: 50, minTier: 3, limits: { resolution: ["1K", "2K"] } });
      // The sibling has no grant, so it carries no marker at all. This is what
      // "on the variant, not the family" has to mean in practice — a family
      // flag would have put the promise on both.
      expect(lite?.unlimited).toBeUndefined();
    });
  });

  /**
   * Retiring a grant has to reach the document.
   *
   * This is the case the `PublicDocument` docblock warns about, and the reason
   * the fingerprint counts as well as maximises: a grant leaving the active set
   * changes what the catalogue says while the newest `provider_models`
   * timestamp sits exactly where it was. Without the grant count in the
   * fingerprint the cached document would go on advertising a withdrawn pipe
   * until something unrelated happened to republish.
   */
  it("stops advertising the pipe as soon as the grant is retired", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-retire-${Math.random().toString(36).slice(2, 8)}`);
      await seedModel(tx, providerId, "retiring", 1, 1, "pro");
      await grant(tx, "retiring-pro", { dailyCap: 50, minTier: 3, covers: null });

      const repository = new PostgresCatalogRepository(tx);
      const before = await repository.list();
      expect(before.families.find((family) => family.id === "retiring")?.variants[0]?.unlimited).toBeDefined();

      const modelId = await modelIdOf(tx, "retiring-pro");
      await tx`update unlimited_entitlements set is_active = false where catalog_model_id = ${modelId}`;

      const after = await repository.list();
      expect(after.families.find((family) => family.id === "retiring")?.variants[0]?.unlimited).toBeUndefined();
    });
  });

  /**
   * A grant pointing at a switched-off provider is not a grant.
   *
   * `findGrant` refuses it at quote time, because the job would have nowhere to
   * run. So the shop has to refuse it too. Advertising it anyway is exactly the
   * disagreement this derivation exists to make impossible, and it is the
   * expensive direction to be wrong in: the customer picks the model *because*
   * it was free.
   */
  it("does not advertise a pipe whose serving provider is switched off", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-dead-${Math.random().toString(36).slice(2, 8)}`);
      await seedModel(tx, providerId, "orphan", 1, 1, "pro");
      const servingProviderId = await grant(tx, "orphan-pro", { dailyCap: 50, minTier: 3, covers: null });

      const repository = new PostgresCatalogRepository(tx);
      const before = await repository.list();
      expect(before.families.find((family) => family.id === "orphan")?.variants[0]?.unlimited).toBeDefined();

      await tx`update providers set is_active = false where id = ${servingProviderId}`;

      const after = await repository.list();
      expect(after.families.find((family) => family.id === "orphan")?.variants[0]?.unlimited).toBeUndefined();
    });
  });

  /**
   * A marker written into the blob by hand is not an offer.
   *
   * `capabilitiesFor` in the catalogue seeder stores the whole variant object,
   * so the moment an `unlimited` key appears on a variant in
   * `src/data/models.ts` it starts arriving here — and #63 proposes exactly
   * that. A marker with no grant row behind it would be published as something
   * the quote path will never honour: the customer picks the model *because* it
   * is free and is then charged.
   *
   * So the blob's copy is dropped unconditionally and the grant table decides.
   * This is the case that makes the derivation worth the extra query.
   */
  it("ignores an unlimited marker seeded into capabilities with no grant behind it", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-seeded-${Math.random().toString(36).slice(2, 8)}`);
      const base = capabilities("claimed", 1, 1, "pro");
      // A marker written by a hand that should not be writing it. That is the
      // whole test: the derivation has to ignore it.
      const blob = { ...base, variant: { ...base.variant, unlimited: { dailyCap: 999, minTier: 1 } } };
      await tx`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
        values (${providerId}, 'claimed/pro', 'claimed pro', 'image', 'claimed', ${tx.json(blob)}, true)
      `;

      const snapshot = await new PostgresCatalogRepository(tx).list();
      const variant = snapshot.families.find((family) => family.id === "claimed")?.variants[0];

      expect(variant?.id).toBe("claimed-pro");
      expect(variant?.unlimited).toBeUndefined();
    });
  });

  /**
   * And a real grant wins over a stale seeded one rather than merging with it.
   *
   * The dangerous version of this bug is not the absent grant but the
   * disagreeing one: a blob saying 999 free a day beside a row saying 50. The
   * customer would be shown the number nobody is going to honour.
   */
  it("publishes the grant's numbers, not the ones written into the blob", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-stale-${Math.random().toString(36).slice(2, 8)}`);
      const base = capabilities("stale", 1, 1, "pro");
      // A marker written by a hand that should not be writing it. That is the
      // whole test: the derivation has to ignore it.
      const blob = { ...base, variant: { ...base.variant, unlimited: { dailyCap: 999, minTier: 1 } } };
      await tx`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
        values (${providerId}, 'stale/pro', 'stale pro', 'image', 'stale', ${tx.json(blob)}, true)
      `;
      await grant(tx, "stale-pro", { dailyCap: 50, minTier: 3, covers: null });

      const snapshot = await new PostgresCatalogRepository(tx).list();
      const variant = snapshot.families.find((family) => family.id === "stale")?.variants[0];

      expect(variant?.unlimited).toEqual({ dailyCap: 50, minTier: 3 });
    });
  });

  /**
   * A reference slot's `group` has to reach the browser.
   *
   * `capabilitiesFor` stores the whole variant, so a `group` written in
   * `src/data/models.ts` lands in `provider_models.capabilities` without any
   * seeder change at all. What it does *not* survive on its own is this parse:
   * zod strips keys a schema does not name, so before `CatalogRefSlotSchema`
   * knew the field, the seeder wrote it, the database held it, and the panel
   * still saw one undifferentiated list of slots.
   *
   * Which is why the fix was a contract line and not a seeder line, and why
   * this test seeds the blob directly rather than going through `models.ts` —
   * the strip is what is being tested, not the authoring.
   */
  it("carries a reference slot's group through to the served catalogue", async () => {
    await inRollback(sql, async (tx) => {
      const providerId = await seedProvider(tx, `cat-group-${Math.random().toString(36).slice(2, 8)}`);
      const base = capabilities("grouped", 1, 1, "pro");
      const blob = {
        ...base,
        variant: {
          ...base.variant,
          refs: [
            { key: "start_frame", label: "start", max: 1, group: "frame" },
            { key: "character", label: "character", max: 2 },
          ],
        },
      };
      await tx`
        insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities, is_active)
        values (${providerId}, 'grouped/pro', 'grouped pro', 'image', 'grouped', ${tx.json(blob)}, true)
      `;

      const snapshot = await new PostgresCatalogRepository(tx).list();
      const refs = snapshot.families.find((family) => family.id === "grouped")?.variants[0]?.refs;

      expect(refs?.[0]).toMatchObject({ key: "start_frame", group: "frame" });
      // Absent stays absent rather than being defaulted to "reference" here.
      // The default belongs to whoever renders it; writing it in would make
      // every existing slot look like it had been edited.
      expect(refs?.[1]).not.toHaveProperty("group");
    });
  });
});
