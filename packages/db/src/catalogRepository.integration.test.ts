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
      const legacy = capabilities("alpha", 0, 0, "ultra") as {
        variant: Record<string, unknown>;
      };
      legacy.variant["model"] = "acme-labs/seedance-2-fast";
      legacy.variant["modelWithRefs"] = "acme-labs/seedance-2-fast-image-to-video";

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
});
