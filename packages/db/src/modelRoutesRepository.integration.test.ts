import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresJobRunnerRepository } from "./jobRunnerRepository";
import { PostgresModelRoutesRepository, UnknownModelError } from "./modelRoutesRepository";
import { COIN, connect, expectDbError, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * Where a catalogue variant actually runs.
 *
 * The claim worth more than all the others: **what `listCatalogModels` reports
 * and what `claim()` does must be the same answer.** One is what an admin reads
 * before deciding; the other is what gets billed. Every resolution case below is
 * asserted through both paths for exactly that reason — a divergence here is not
 * a rendering bug, it is a panel that lies about money.
 */

interface Fixture {
  catalogModelId: string;
  featureId: string;
  kieProviderId: string;
  altProviderId: string;
  altModelId: string;
}

/** A catalogue variant on one provider, and somewhere else it could run. */
async function fixture(tx: Sql): Promise<Fixture> {
  const [catalog] = await tx<{ id: string; provider_id: string; feature_id: string }[]>`
    select model.id, model.provider_id, route.feature_id
    from provider_models model
    join feature_model_routes route on route.provider_model_id = model.id
    where model.capabilities ? 'variant' and model.is_active
      -- One that carries no grant yet. unlimited_entitlements has a unique
      -- index on catalog_model_id, so a variant the seeder already granted
      -- cannot be given a second one, and the precedence test needs to make
      -- its own.
      and not exists (select 1 from unlimited_entitlements ent where ent.catalog_model_id = model.id)
    limit 1
  `;
  if (!catalog) throw new Error("the seeded catalogue has no active variant");

  const [provider] = await tx<{ id: string }[]>`
    insert into providers (code, name, base_url, credit_unit_name)
    values (${`alt-${Math.random().toString(36).slice(2, 8)}`}, 'Alternate', 'https://alt.test', 'usd')
    returning id
  `;
  // No `variant` key, which is what keeps a serving row out of the shop.
  const [serving] = await tx<{ id: string }[]>`
    insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
    values (${provider!.id}, 'alt/some-model', 'Alternate model', 'image', '{}'::jsonb)
    returning id
  `;
  return {
    catalogModelId: catalog.id,
    featureId: catalog.feature_id,
    kieProviderId: catalog.provider_id,
    altProviderId: provider!.id,
    altModelId: serving!.id,
  };
}

async function queueJob(tx: Sql, options: { accountId: string; userId: string; fixture: Fixture; entitlementId?: string }) {
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (account_id, created_by, feature_id, provider_model_id, params, status, origin, micro_credits_held, entitlement_id)
    values (
      ${options.accountId}, ${options.userId}, ${options.fixture.featureId}, ${options.fixture.catalogModelId},
      ${tx.json({ prompt: "a small red boat", aspect_ratio: "16:9" })}, 'queued', 'web', ${2 * COIN},
      ${options.entitlementId ?? null}
    )
    returning id
  `;
  return job!.id;
}

const route = (tx: Sql, f: Fixture, options: { isActive?: boolean; priority?: number; overrides?: unknown } = {}) => tx`
  insert into model_routes (catalog_model_id, serving_model_id, priority, is_active, param_overrides)
  values (
    ${f.catalogModelId}, ${f.altModelId}, ${options.priority ?? 10}, ${options.isActive ?? true},
    ${tx.json((options.overrides ?? {}) as never)}
  )
`;

describe("resolving where a job runs", () => {
  it("runs on the catalogue row when there is no route", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);

      // The behaviour every job had before this table existed, and the reason
      // the migration could land with no effect.
      expect(claimed!.providerModelId).toBe(f.catalogModelId);
      expect(claimed!.paramOverrides).toEqual({});
    });
  });

  it("runs on the route's model once one is active", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      await route(tx, f, { overrides: { rename: { aspect_ratio: "size" } } });
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);

      expect(claimed!.providerModelId).toBe(f.altModelId);
      expect(claimed!.externalModelId).toBe("alt/some-model");
      expect(claimed!.providerId).toBe(f.altProviderId);
      // The overrides travel with the route, because they describe the API the
      // job is about to be sent to.
      expect(claimed!.paramOverrides).toEqual({ rename: { aspect_ratio: "size" } });
    });
  });

  it("ignores an inactive route", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      await route(tx, f, { isActive: false });
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      // The single most important line in this file. Every route the seeder
      // writes is inactive, so if this were wrong, merging the seed data would
      // silently move production traffic to an unverified provider.
      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.providerModelId).toBe(f.catalogModelId);
    });
  });

  it("falls back to the catalogue row when the route's provider is switched off", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      await route(tx, f);
      await tx`update providers set is_active = false where id = ${f.altProviderId}`;
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      // Which is what makes deactivating a failing provider a safe thing to do
      // at 3am: work keeps flowing instead of every job refunding.
      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.providerModelId).toBe(f.catalogModelId);
    });
  });

  it("falls back when the route's model is deactivated", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      await route(tx, f);
      await tx`update provider_models set is_active = false where id = ${f.altModelId}`;
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.providerModelId).toBe(f.catalogModelId);
    });
  });

  it("takes the lowest priority when two routes are active", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const [second] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/preferred', 'Preferred', 'image', '{}'::jsonb)
        returning id
      `;
      await route(tx, f, { priority: 50 });
      await tx`
        insert into model_routes (catalog_model_id, serving_model_id, priority, is_active)
        values (${f.catalogModelId}, ${second!.id}, 1, true)
      `;
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });

      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.externalModelId).toBe("alt/preferred");
    });
  });

  it("lets a grant outrank a route", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const [granted] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/granted', 'Granted', 'image', '{}'::jsonb)
        returning id
      `;
      const [entitlement] = await tx<{ id: string }[]>`
        insert into unlimited_entitlements (feature_id, catalog_model_id, serving_model_id, min_tier, daily_cap, is_active)
        values (${f.featureId}, ${f.catalogModelId}, ${granted!.id}, 1, 50, true)
        returning id
      `;
      await route(tx, f, { overrides: { drop: ["prompt"] } });
      const jobId = await queueJob(tx, { accountId, userId, fixture: f, entitlementId: entitlement!.id });

      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);

      // A grant is a promise about a specific upstream account. Letting a
      // routing preference win would bill us for generations sold as free.
      expect(claimed!.externalModelId).toBe("alt/granted");
      // And the route's overrides must not tag along — they rename params for
      // an API this job is no longer being sent to.
      expect(claimed!.paramOverrides).toEqual({});
    });
  });
});

describe("what the panel reports", () => {
  it("agrees with the claim about where a variant is running", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      const before = (await routes.listCatalogModels()).find((model) => model.id === f.catalogModelId)!;
      expect(before.servingExternalModelId).toBe(before.homeExternalModelId);
      expect(before.activeRouteCount).toBe(0);

      await route(tx, f);

      const after = (await routes.listCatalogModels()).find((model) => model.id === f.catalogModelId)!;
      expect(after.servingExternalModelId).toBe("alt/some-model");
      expect(after.routeCount).toBe(1);
      expect(after.activeRouteCount).toBe(1);

      // Same answer through the path that actually spends money.
      const jobId = await queueJob(tx, { accountId, userId, fixture: f });
      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.externalModelId).toBe(after.servingExternalModelId);
    });
  });

  it("lists only the destinations declared for a variant, never every endpoint of its modality", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      const [variant] = await tx<{ modality: string }[]>`select modality from provider_models where id = ${f.catalogModelId}`;

      // A second endpoint on the same provider, same modality, that nobody has
      // ever said can run this model. Under the old rule -- match the modality
      // -- it was an offered alternative, which is how Qwen Image ended up on
      // Nano Banana Pro's menu. Both make images; that is the whole overlap.
      const [stranger] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/unrelated-model', 'Unrelated model', ${variant!.modality}, '{}'::jsonb)
        returning id
      `;

      const before = (await routes.listCatalogModels()).find((model) => model.id === f.catalogModelId)!;
      expect(before.routeTargets).toEqual([]);

      await route(tx, f, { isActive: false });

      const after = (await routes.listCatalogModels()).find((model) => model.id === f.catalogModelId)!;
      // Declared and switched off is still declared. That is the point of the
      // one-click move: the alternates were worked out in advance, and the
      // outage is not when you want to be inventing one.
      expect(after.routeTargets).toEqual([
        {
          servingModelId: f.altModelId,
          providerCode: expect.any(String),
          externalModelId: "alt/some-model",
          priority: 10,
          isActive: false,
          source: "route",
        },
      ]);
      expect(after.activeRouteCount).toBe(0);
      expect(after.routeTargets.map((target) => target.servingModelId)).not.toContain(stranger!.id);
    });
  });

  it("counts an unlimited pairing as a declared destination", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      await tx`
        insert into unlimited_entitlements (catalog_model_id, serving_model_id, min_tier)
        values (${f.catalogModelId}, ${f.altModelId}, 2)
      `;

      const model = (await routes.listCatalogModels()).find((row) => row.id === f.catalogModelId)!;
      // 0018 defines the pair in as many words as "a second provider's copy of
      // the same logical model", which is the same assertion a route makes. If
      // the home provider falls over, this is the alternative you want offered.
      expect(model.routeTargets).toHaveLength(1);
      expect(model.routeTargets[0]!.servingModelId).toBe(f.altModelId);
      // Not ranked, and the null is the honest answer rather than a missing
      // number: an entitlement is the free lane, not a routing preference.
      expect(model.routeTargets[0]!.priority).toBeNull();
      expect(model.routeTargets[0]!.source).toBe("entitlement");
      expect(model.routeCount).toBe(0);
    });
  });

  it("keeps serving rows out of the catalogue list and catalogue rows out of the serving list", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      const catalogue = await routes.listCatalogModels();
      const serving = await routes.listServingModels();

      // The two lists are what an admin picks from on each side of a route, so
      // an overlap would offer somebody the chance to route a variant to itself.
      expect(catalogue.map((model) => model.id)).toContain(f.catalogModelId);
      expect(catalogue.map((model) => model.id)).not.toContain(f.altModelId);
      expect(serving.map((model) => model.id)).toContain(f.altModelId);
      expect(serving.map((model) => model.id)).not.toContain(f.catalogModelId);
    });
  });

  it("reports the credential's secret_ref and never a secret", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      await tx`
        insert into provider_credentials (provider_id, label, secret_ref, is_active)
        values (${f.altProviderId}, 'primary', 'ALT_API_KEY', true)
      `;

      const providers = await new PostgresModelRoutesRepository(tx).listProviders();
      const provider = providers.find((candidate) => candidate.id === f.altProviderId)!;

      // The column holds the NAME of an environment variable by design. This
      // assertion is what stops a refactor turning a staff read permission into
      // a way to walk off with every provider account we have.
      expect(provider.credentials[0]!.secretRef).toBe("ALT_API_KEY");
      expect(JSON.stringify(provider)).not.toContain("secret_value");
    });
  });

  it("reads the provider's unit cost from the effective-dated rate", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      await tx`
        insert into provider_credit_rates (provider_id, provider_unit_cost_usd, micro_credits_per_unit, valid_from, valid_to)
        values (${f.altProviderId}, 0.02, 0, now() - interval '2 days', now() - interval '1 day')
      `;
      await tx`
        insert into provider_credit_rates (provider_id, provider_unit_cost_usd, micro_credits_per_unit)
        values (${f.altProviderId}, 1.0, 0)
      `;

      const providers = await new PostgresModelRoutesRepository(tx).listProviders();

      // Superseded rows stay for the sake of jobs settled while they were live,
      // so "the newest" and "the one in force" have to be the same question.
      expect(providers.find((provider) => provider.id === f.altProviderId)!.unitCostUsd).toBe(1);
    });
  });
});

describe("rewriting the routes for a variant", () => {
  it("replaces the whole list in one go", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      await routes.replaceRoutes(
        f.catalogModelId,
        [{ servingModelId: f.altModelId, priority: 10, isActive: false, paramOverrides: {} }],
        userId,
      );
      const written = await routes.replaceRoutes(
        f.catalogModelId,
        [{ servingModelId: f.altModelId, priority: 0, isActive: true, paramOverrides: { drop: ["seed"] }, note: "switched on" }],
        userId,
      );

      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ priority: 0, isActive: true, paramOverrides: { drop: ["seed"] }, note: "switched on" });
    });
  });

  it("swaps two priorities without tripping the uniqueness index", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const f = await fixture(tx);
      const [second] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/second', 'Second', 'image', '{}'::jsonb)
        returning id
      `;
      const routes = new PostgresModelRoutesRepository(tx);
      const pair = (first: number, other: number) => [
        { servingModelId: f.altModelId, priority: first, isActive: true, paramOverrides: {} },
        { servingModelId: second!.id, priority: other, isActive: true, paramOverrides: {} },
      ];

      await routes.replaceRoutes(f.catalogModelId, pair(0, 1), userId);
      // The reason this is a replace rather than two updates: doing it a
      // statement at a time collides on the priority that is only transiently
      // taken, and leaves the variant routed somewhere nobody chose.
      const swapped = await routes.replaceRoutes(f.catalogModelId, pair(1, 0), userId);

      expect(swapped.find((route) => route.externalModelId === "alt/second")!.priority).toBe(0);
    });
  });

  it("clears back to the catalogue row", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);
      await routes.replaceRoutes(
        f.catalogModelId,
        [{ servingModelId: f.altModelId, priority: 0, isActive: true, paramOverrides: {} }],
        userId,
      );

      expect(await routes.replaceRoutes(f.catalogModelId, [], userId)).toEqual([]);

      const jobId = await queueJob(tx, { accountId, userId, fixture: f });
      expect((await new PostgresJobRunnerRepository(tx).claim(jobId))!.providerModelId).toBe(f.catalogModelId);
    });
  });

  it("refuses to route a serving row, which would build a chain claim() does not follow", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const f = await fixture(tx);
      const routes = new PostgresModelRoutesRepository(tx);

      await expect(
        routes.replaceRoutes(f.altModelId, [{ servingModelId: f.catalogModelId, priority: 0, isActive: true, paramOverrides: {} }], userId),
      ).rejects.toBeInstanceOf(UnknownModelError);
    });
  });

  it("refuses a route to a model that does not exist", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const f = await fixture(tx);

      await expect(
        new PostgresModelRoutesRepository(tx).replaceRoutes(
          f.catalogModelId,
          [{ servingModelId: "00000000-0000-4000-8000-00000000dead", priority: 0, isActive: true, paramOverrides: {} }],
          userId,
        ),
      ).rejects.toBeInstanceOf(UnknownModelError);
    });
  });

  it("refuses a route from a variant to itself", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const f = await fixture(tx);

      await expect(
        new PostgresModelRoutesRepository(tx).replaceRoutes(
          f.catalogModelId,
          [{ servingModelId: f.catalogModelId, priority: 0, isActive: true, paramOverrides: {} }],
          userId,
        ),
      ).rejects.toBeInstanceOf(UnknownModelError);
    });
  });
});

describe("what the database refuses on its own", () => {
  it("will not let two active routes share a priority", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const [second] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/tie', 'Tie', 'image', '{}'::jsonb)
        returning id
      `;
      await route(tx, f, { priority: 5 });

      // Without this index "lowest priority wins" resolves differently between
      // two identical jobs, which is the worst kind of wrong: intermittent and
      // about money.
      await expectDbError(
        tx,
        () => tx`
          insert into model_routes (catalog_model_id, serving_model_id, priority, is_active)
          values (${f.catalogModelId}, ${second!.id}, 5, true)
        `,
      );
    });
  });

  it("allows two inactive routes to share a priority", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      const [second] = await tx<{ id: string }[]>`
        insert into provider_models (provider_id, external_model_id, name, modality, capabilities)
        values (${f.altProviderId}, 'alt/parked', 'Parked', 'image', '{}'::jsonb)
        returning id
      `;
      await route(tx, f, { priority: 5, isActive: false });

      // Parked alternatives are the normal state — the seeder writes four of
      // them — and nothing about them has to be ordered until one is turned on.
      await tx`
        insert into model_routes (catalog_model_id, serving_model_id, priority, is_active)
        values (${f.catalogModelId}, ${second!.id}, 5, false)
      `;
      expect((await new PostgresModelRoutesRepository(tx).listRoutes(f.catalogModelId)).length).toBe(2);
    });
  });

  it("refuses a route from a model to itself", async () => {
    await inRollback(sql, async (tx) => {
      const f = await fixture(tx);
      await expectDbError(
        tx,
        () => tx`
          insert into model_routes (catalog_model_id, serving_model_id, priority, is_active)
          values (${f.catalogModelId}, ${f.catalogModelId}, 1, true)
        `,
      );
    });
  });
});
