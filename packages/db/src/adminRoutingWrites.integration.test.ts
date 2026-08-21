import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCatalogRepository } from "./catalogRepository";
import { PostgresJobRunnerRepository } from "./jobRunnerRepository";
import { ConflictError, PostgresModelRoutesRepository, UnknownModelError } from "./modelRoutesRepository";
import { COIN, connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * The writes the panel gained: adding a provider, adding somewhere to send a
 * model, and moving a model in one action.
 *
 * Before these, routing was admin-editable but the set of destinations was not
 * — four rows, seeded from `routes.wavespeed.json`, and a fifth meant editing
 * JSON and re-running a script against production.
 *
 * Two properties are worth more than the rest of this file:
 *
 *   1. **A destination is never in the shop.** `catalogRepository` decides what
 *      a customer can buy by testing `capabilities ? 'variant'`. If a row
 *      created here could ever carry that key, adding a routing target would
 *      quietly add a product.
 *   2. **`routeTo` and `claim()` agree.** The panel shows an admin where a model
 *      is going; the claim decides where it actually goes and who is billed for
 *      it. Asserting only the first would let them drift apart.
 */

interface Fixture {
  catalogModelId: string;
  featureId: string;
  providerId: string;
}

async function fixture(tx: Sql): Promise<Fixture> {
  const [catalog] = await tx<{ id: string; feature_id: string }[]>`
    select model.id, route.feature_id
    from provider_models model
    join feature_model_routes route on route.provider_model_id = model.id
    where model.capabilities ? 'variant' and model.is_active
      and not exists (select 1 from unlimited_entitlements ent where ent.catalog_model_id = model.id)
    limit 1
  `;
  if (!catalog) throw new Error("the seeded catalogue has no active variant");

  const [provider] = await tx<{ id: string }[]>`
    insert into providers (code, name, credit_unit_name)
    values (${`alt-${Math.random().toString(36).slice(2, 8)}`}, 'Alternate', 'usd')
    returning id
  `;
  return { catalogModelId: catalog.id, featureId: catalog.feature_id, providerId: provider!.id };
}

const queueJob = async (tx: Sql, f: Fixture, accountId: string, userId: string) => {
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (account_id, created_by, feature_id, provider_model_id, params, status, origin, micro_credits_held)
    values (
      ${accountId}, ${userId}, ${f.featureId}, ${f.catalogModelId},
      ${tx.json({ prompt: "a small red boat", aspect_ratio: "16:9" })}, 'queued', 'web', ${2 * COIN}
    )
    returning id
  `;
  return job!.id;
};

describe("adding a provider from the panel", () => {
  it("writes the credential as an environment variable NAME, and stores no key", async () => {
    await inRollback(sql, async (tx) => {
      const repository = new PostgresModelRoutesRepository(tx);
      const code = `new-${Math.random().toString(36).slice(2, 8)}`;

      const created = await repository.createProvider(
        { code, name: "A New Provider", baseUrl: "https://api.new.test", secretRef: "NEW_PROVIDER_API_KEY", creditUnitName: "credit" },
        null,
      );

      expect(created.code).toBe(code);
      expect(created.credentials).toHaveLength(1);
      // The column has only ever held a name. A database dump must not be a
      // set of provider accounts.
      expect(created.credentials[0]!.secretRef).toBe("NEW_PROVIDER_API_KEY");

      const [row] = await tx<{ secret_ref: string }[]>`
        select secret_ref from provider_credentials where provider_id = ${created.id}
      `;
      expect(row!.secret_ref).toBe("NEW_PROVIDER_API_KEY");
    });
  });

  it("opens a credit rate when one is given, and leaves the cost unknown when it is not", async () => {
    await inRollback(sql, async (tx) => {
      const repository = new PostgresModelRoutesRepository(tx);

      const priced = await repository.createProvider(
        {
          code: `p-${Math.random().toString(36).slice(2, 8)}`,
          name: "Priced",
          secretRef: "PRICED_KEY",
          creditUnitName: "usd",
          unitCostUsd: 0.25,
        },
        null,
      );
      expect(priced.unitCostUsd).toBe(0.25);

      const unpriced = await repository.createProvider(
        { code: `u-${Math.random().toString(36).slice(2, 8)}`, name: "Unpriced", secretRef: "UNPRICED_KEY", creditUnitName: "credit" },
        null,
      );
      // Null rather than zero. A provider whose cost nobody has recorded should
      // read as unknown in the margin trail, not as free.
      expect(unpriced.unitCostUsd).toBeNull();
    });
  });

  it("refuses a code that already exists rather than quietly rewriting it", async () => {
    await inRollback(sql, async (tx) => {
      const repository = new PostgresModelRoutesRepository(tx);
      const code = `dup-${Math.random().toString(36).slice(2, 8)}`;
      await repository.createProvider({ code, name: "First", secretRef: "FIRST_KEY", creditUnitName: "credit" }, null);

      // Upserting here is how a provider's base URL changes without anyone
      // having decided to change it.
      await expect(
        repository.createProvider({ code, name: "Second", secretRef: "SECOND_KEY", creditUnitName: "credit" }, null),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });
});

describe("adding somewhere to send a model", () => {
  it("never puts the new row in the shop", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);

      const countVariants = async () =>
        (await new PostgresCatalogRepository(tx).list()).families.reduce((total, family) => total + family.variants.length, 0);

      const before = await countVariants();
      const created = await repository.createServingModel({
        providerId: f.providerId,
        externalModelId: "alt/brand-new",
        name: "Brand New",
        modality: "image",
      });
      const after = await countVariants();

      expect(created.externalModelId).toBe("alt/brand-new");
      expect((await repository.listServingModels()).some((model) => model.id === created.id)).toBe(true);

      // The whole safety property: a routing destination is not a product.
      expect(after).toBe(before);
      const snapshot = await new PostgresCatalogRepository(tx).list();
      expect(snapshot.families.some((family) => family.variants.some((variant) => variant.label === "Brand New"))).toBe(false);

      const [row] = await tx<{ capabilities: Record<string, unknown> }[]>`
        select capabilities from provider_models where id = ${created.id}
      `;
      expect(row!.capabilities).toEqual({});
    });
  });

  it("refuses a duplicate model id under the same provider", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);
      const input = { providerId: f.providerId, externalModelId: "alt/twice", name: "Twice", modality: "image" as const };

      await repository.createServingModel(input);
      await expect(repository.createServingModel(input)).rejects.toBeInstanceOf(ConflictError);
    });
  });

  it("refuses a provider that does not exist", async () => {
    await inRollback(sql, async (tx) => {
      const repository = new PostgresModelRoutesRepository(tx);
      await expect(
        repository.createServingModel({
          providerId: "00000000-0000-4000-8000-000000000000",
          externalModelId: "nowhere/model",
          name: "Nowhere",
          modality: "image",
        }),
      ).rejects.toBeInstanceOf(UnknownModelError);
    });
  });
});

describe("moving a model in one action", () => {
  it("sends the next job to the chosen destination, as claim() resolves it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);
      const destination = await repository.createServingModel({
        providerId: f.providerId,
        externalModelId: "alt/chosen",
        name: "Chosen",
        modality: "image",
      });

      await repository.routeTo(f.catalogModelId, destination.id, userId);

      // What the panel now says…
      const listed = (await repository.listCatalogModels()).find((model) => model.id === f.catalogModelId);
      expect(listed!.servingExternalModelId).toBe("alt/chosen");

      // …and what the job actually does. These must not be able to disagree.
      const jobId = await queueJob(tx, f, accountId, userId);
      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);
      expect(claimed!.providerModelId).toBe(destination.id);
      expect(claimed!.externalModelId).toBe("alt/chosen");
    });
  });

  it("keeps the parameter translation an existing route already carried", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);
      const destination = await repository.createServingModel({
        providerId: f.providerId,
        externalModelId: "alt/needs-translation",
        name: "Needs translation",
        modality: "image",
      });

      // Parked with its translation, exactly as the seeder writes the four
      // WaveSpeed routes: switched off, and useless without the rename.
      await tx`
        insert into model_routes (catalog_model_id, serving_model_id, priority, is_active, param_overrides)
        values (${f.catalogModelId}, ${destination.id}, 10, false, ${tx.json({ rename: { aspect_ratio: "size" } } as never)})
      `;

      await repository.routeTo(f.catalogModelId, destination.id, userId);

      const jobId = await queueJob(tx, f, accountId, userId);
      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);
      // Reset to {} here and every job posts KIE's vocabulary at a provider
      // that does not speak it — the exact failure the one-click move looks
      // like it is avoiding.
      expect(claimed!.paramOverrides).toEqual({ rename: { aspect_ratio: "size" } });
    });
  });

  it("stands down whatever was winning, without tripping the priority index", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);
      const first = await repository.createServingModel({
        providerId: f.providerId,
        externalModelId: "alt/first",
        name: "First",
        modality: "image",
      });
      const second = await repository.createServingModel({
        providerId: f.providerId,
        externalModelId: "alt/second",
        name: "Second",
        modality: "image",
      });

      await repository.routeTo(f.catalogModelId, first.id, null);
      // Both land on priority 10. Without the stand-down in the same
      // transaction this is the partial unique index on
      // (catalog_model_id, priority) where is_active.
      const routes = await repository.routeTo(f.catalogModelId, second.id, null);

      const active = routes.filter((route) => route.isActive);
      expect(active).toHaveLength(1);
      expect(active[0]!.servingModelId).toBe(second.id);
      // The loser is kept, switched off — it is a decision somebody made once
      // and may want back, not rubbish.
      expect(routes.some((route) => route.servingModelId === first.id && !route.isActive)).toBe(true);
    });
  });

  it("refuses to route a variant at itself, or at a model that is not there", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);

      await expect(repository.routeTo(f.catalogModelId, f.catalogModelId, null)).rejects.toBeInstanceOf(UnknownModelError);
      await expect(repository.routeTo(f.catalogModelId, "00000000-0000-4000-8000-000000000000", null)).rejects.toBeInstanceOf(
        UnknownModelError,
      );
    });
  });

  it("refuses to route FROM something that is not in the catalogue", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const repository = new PostgresModelRoutesRepository(tx);
      const a = await repository.createServingModel({ providerId: f.providerId, externalModelId: "alt/a", name: "A", modality: "image" });
      const b = await repository.createServingModel({ providerId: f.providerId, externalModelId: "alt/b", name: "B", modality: "image" });

      // A chain claim() does not follow: the job would run somewhere the panel
      // never showed.
      await expect(repository.routeTo(a.id, b.id, null)).rejects.toBeInstanceOf(UnknownModelError);
    });
  });
});
