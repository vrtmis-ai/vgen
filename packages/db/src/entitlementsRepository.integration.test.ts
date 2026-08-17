import type { Sql, TransactionSql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresEntitlementsRepository } from "./entitlementsRepository";
import { connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const asTx = (tx: Sql) => tx as unknown as TransactionSql;

interface Fixture {
  accountId: string;
  catalogModelId: string;
  servingModelId: string;
  featureId: string;
  otherFeatureId: string;
  grantId: string;
}

/**
 * A catalogue model, a second provider's copy of it, and a grant joining them.
 *
 * Seeded rather than leaned on: the real rows are in this database, but a test
 * that asserts against the seeded Nano Banana becomes a test of the seeder's
 * current numbers, and would start failing the day someone changes the cap.
 */
async function seed(tx: Sql, options: { minTier?: number; dailyCap?: number | null; featureScoped?: boolean } = {}): Promise<Fixture> {
  const { accountId } = await makeUser(tx);

  const suffix = Math.random().toString(36).slice(2, 10);
  const [paidProvider] = await tx<{ id: string }[]>`
    insert into providers (code, name) values (${`paid-${suffix}`}, 'Paid') returning id
  `;
  const [freeProvider] = await tx<{ id: string }[]>`
    insert into providers (code, name) values (${`free-${suffix}`}, 'Free') returning id
  `;

  const features = await tx<{ id: string; code: string }[]>`
    select id, code from features where code in ('image_generate', 'image_edit') order by code
  `;
  const featureId = features.find((f) => f.code === "image_generate")!.id;
  const otherFeatureId = features.find((f) => f.code === "image_edit")!.id;

  // The catalogue row carries a variant; the serving row deliberately does not.
  const [catalogModel] = await tx<{ id: string }[]>`
    insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities)
    values (${paidProvider!.id}, ${`m-${suffix}`}, 'Test Model', 'image', 'test-family',
            ${tx.json({ variant: { id: `v-${suffix}` } })})
    returning id
  `;
  const [servingModel] = await tx<{ id: string }[]>`
    insert into provider_models (provider_id, external_model_id, name, modality, family, capabilities)
    values (${freeProvider!.id}, ${`m-${suffix}`}, 'Test Model (unlimited)', 'image', 'test-family',
            ${tx.json({ serves: `v-${suffix}` })})
    returning id
  `;

  const [grant] = await tx<{ id: string }[]>`
    insert into unlimited_entitlements (catalog_model_id, serving_model_id, feature_id, min_tier, daily_cap)
    values (${catalogModel!.id}, ${servingModel!.id},
            ${options.featureScoped === false ? null : featureId},
            ${options.minTier ?? 2}, ${options.dailyCap === undefined ? 50 : options.dailyCap})
    returning id
  `;

  return {
    accountId,
    catalogModelId: catalogModel!.id,
    servingModelId: servingModel!.id,
    featureId,
    otherFeatureId,
    grantId: grant!.id,
  };
}

/** Puts the account on a plan of the given tier, the way a purchase would. */
async function subscribeWithConcurrency(tx: Sql, accountId: string, tier: number, maxConcurrentJobs?: number): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, max_concurrent_jobs)
    values (${`plan-${suffix}`}, 'Test Plan', ${tier}, 1000000, 10, ${maxConcurrentJobs ?? 3})
    returning id
  `;
  await tx`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;
}

const subscribe = (tx: Sql, accountId: string, tier: number) => subscribeWithConcurrency(tx, accountId, tier);

describe("the tier gate", () => {
  it("puts an account with no subscription on tier 1", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      expect(await new PostgresEntitlementsRepository(tx).tierForAccount(accountId)).toBe(1);
    });
  });

  it("reads the tier off a live subscription", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      expect(await new PostgresEntitlementsRepository(tx).tierForAccount(accountId)).toBe(3);
    });
  });

  // Matching what v_account_entitlements does for every other perk: two live
  // plans give the best of both, never whichever was bought last.
  it("takes the best tier when two plans overlap", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await subscribe(tx, accountId, 3);
      await subscribe(tx, accountId, 1);
      expect(await new PostgresEntitlementsRepository(tx).tierForAccount(accountId)).toBe(3);
    });
  });

  // The one that decides whether a lapsed customer keeps their models.
  it("drops back to tier 1 when the term has ended", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      const [plan] = await tx<{ id: string }[]>`
        insert into plans (code, name, tier, micro_credits_per_term, price_amount)
        values (${`expired-${Math.random().toString(36).slice(2, 8)}`}, 'Expired', 3, 1000000, 10)
        returning id
      `;
      await tx`
        insert into subscriptions (account_id, plan_id, status, starts_at, ends_at)
        values (${accountId}, ${plan!.id}, 'active', now() - interval '60 days', now() - interval '1 day')
      `;
      expect(await new PostgresEntitlementsRepository(tx).tierForAccount(accountId)).toBe(1);
    });
  });
});

describe("how many generations an account may run at once", () => {
  /** A job in flight, which is what the limit is counted against. */
  async function seedJob(tx: Sql, accountId: string, userId: string, status: string): Promise<void> {
    const [feature] = await tx<{ id: string }[]>`select id from features limit 1`;
    await tx`
      insert into jobs (account_id, created_by, feature_id, status)
      values (${accountId}, ${userId}, ${feature!.id}, ${status})
    `;
  }

  it("gives an account with no plan the floor of one", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      expect(await new PostgresEntitlementsRepository(tx).concurrencyFor(accountId)).toEqual({ limit: 1, running: 0 });
    });
  });

  it("reads the limit off the plan", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await subscribeWithConcurrency(tx, accountId, 3, 8);
      const { limit } = await new PostgresEntitlementsRepository(tx).concurrencyFor(accountId);
      expect(limit).toBe(8);
    });
  });

  it("takes the best limit when two plans overlap", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await subscribeWithConcurrency(tx, accountId, 1, 2);
      await subscribeWithConcurrency(tx, accountId, 3, 8);
      const { limit } = await new PostgresEntitlementsRepository(tx).concurrencyFor(accountId);
      expect(limit).toBe(8);
    });
  });

  it("counts queued and running jobs, and nothing else", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId, userId } = await makeUser(tx);
      await subscribeWithConcurrency(tx, accountId, 3, 8);
      for (const status of ["queued", "running", "succeeded", "failed", "cancelled", "draft"]) {
        await seedJob(tx, accountId, userId, status);
      }
      const { running } = await new PostgresEntitlementsRepository(tx).concurrencyFor(accountId);
      expect(running).toBe(2);
    });
  });

  it("does not count another account's jobs", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await seedJob(tx, theirs.accountId, theirs.userId, "running");
      const { running } = await new PostgresEntitlementsRepository(tx).concurrencyFor(mine.accountId);
      expect(running).toBe(0);
    });
  });

  // account_limits is an admin override that may only ever raise the ceiling,
  // which is what v_account_entitlements already promises for every other perk.
  it("lets an admin override raise the limit but never lower it", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await subscribeWithConcurrency(tx, accountId, 3, 8);
      const repo = new PostgresEntitlementsRepository(tx);

      await tx`insert into account_limits (account_id, max_concurrent_jobs) values (${accountId}, 2)`;
      expect((await repo.concurrencyFor(accountId)).limit).toBe(8);

      await tx`update account_limits set max_concurrent_jobs = 20 where account_id = ${accountId}`;
      expect((await repo.concurrencyFor(accountId)).limit).toBe(20);
    });
  });
});

describe("finding an unlimited grant", () => {
  it("finds one for an account whose tier reaches it", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { minTier: 2 });
      const grant = await new PostgresEntitlementsRepository(tx).findGrant(f.catalogModelId, f.featureId, 2);
      expect(grant?.servingModelId).toBe(f.servingModelId);
      expect(grant?.dailyCap).toBe(50);
    });
  });

  it("refuses an account below the tier", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { minTier: 2 });
      expect(await new PostgresEntitlementsRepository(tx).findGrant(f.catalogModelId, f.featureId, 1)).toBeNull();
    });
  });

  // "Unlimited Nano Banana" for image_generate must not quietly also make
  // editing free — that is a different feature with a different provider cost.
  it("does not leak across features", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx);
      expect(await new PostgresEntitlementsRepository(tx).findGrant(f.catalogModelId, f.otherFeatureId, 3)).toBeNull();
    });
  });

  it("covers every feature when the grant names none", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { featureScoped: false });
      const repo = new PostgresEntitlementsRepository(tx);
      expect(await repo.findGrant(f.catalogModelId, f.featureId, 3)).not.toBeNull();
      expect(await repo.findGrant(f.catalogModelId, f.otherFeatureId, 3)).not.toBeNull();
    });
  });

  // Otherwise the quote comes back free and the job has nowhere to run.
  it("ignores a grant whose serving model has been switched off", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx);
      await tx`update provider_models set is_active = false where id = ${f.servingModelId}`;
      expect(await new PostgresEntitlementsRepository(tx).findGrant(f.catalogModelId, f.featureId, 3)).toBeNull();
    });
  });

  it("ignores a deactivated grant", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx);
      await tx`update unlimited_entitlements set is_active = false where id = ${f.grantId}`;
      expect(await new PostgresEntitlementsRepository(tx).findGrant(f.catalogModelId, f.featureId, 3)).toBeNull();
    });
  });
});

describe("the daily allowance", () => {
  it("reports a full allowance before anything is spent", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 3 });
      const available = await new PostgresEntitlementsRepository(tx).availability(f.catalogModelId, f.featureId, f.accountId, 2);
      expect(available).toMatchObject({ used: 0, remaining: 3 });
    });
  });

  it("counts down as claims are taken", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 3 });
      const repo = new PostgresEntitlementsRepository(tx);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(1);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(2);
      const available = await repo.availability(f.catalogModelId, f.featureId, f.accountId, 2);
      expect(available).toMatchObject({ used: 2, remaining: 1 });
    });
  });

  // The assertion the whole cap exists for.
  it("refuses the claim past the cap", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 2 });
      const repo = new PostgresEntitlementsRepository(tx);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(1);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(2);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBeNull();
      const available = await repo.availability(f.catalogModelId, f.featureId, f.accountId, 2);
      expect(available).toMatchObject({ used: 2, remaining: 0 });
    });
  });

  it("never refuses an uncapped grant", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: null });
      const repo = new PostgresEntitlementsRepository(tx);
      for (let i = 1; i <= 5; i++) expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(i);
      const available = await repo.availability(f.catalogModelId, f.featureId, f.accountId, 2);
      expect(available).toMatchObject({ used: 5, remaining: null });
    });
  });

  // A provider failure is not a use.
  it("gives the allowance back on release", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 2 });
      const repo = new PostgresEntitlementsRepository(tx);
      await repo.claim(asTx(tx), f.grantId, f.accountId);
      await repo.claim(asTx(tx), f.grantId, f.accountId);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBeNull();

      await repo.release(asTx(tx), f.grantId, f.accountId);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(2);
    });
  });

  // Releasing twice must not hand out a free day.
  it("does not let release drive the counter below zero", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 2 });
      const repo = new PostgresEntitlementsRepository(tx);
      await repo.claim(asTx(tx), f.grantId, f.accountId);
      await repo.release(asTx(tx), f.grantId, f.accountId);
      await repo.release(asTx(tx), f.grantId, f.accountId);
      const available = await repo.availability(f.catalogModelId, f.featureId, f.accountId, 2);
      expect(available).toMatchObject({ used: 0, remaining: 2 });
    });
  });

  it("keeps two accounts' allowances separate", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { dailyCap: 1 });
      const other = await makeUser(tx);
      const repo = new PostgresEntitlementsRepository(tx);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBe(1);
      expect(await repo.claim(asTx(tx), f.grantId, f.accountId)).toBeNull();
      expect(await repo.claim(asTx(tx), f.grantId, other.accountId)).toBe(1);
    });
  });

  it("reports no availability at all for an account the grant does not reach", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx, { minTier: 3 });
      expect(await new PostgresEntitlementsRepository(tx).availability(f.catalogModelId, f.featureId, f.accountId, 2)).toBeNull();
    });
  });
});

describe("the schema's own guarantees", () => {
  it("refuses a grant that points at itself", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx);
      await expect(
        tx`
          insert into unlimited_entitlements (catalog_model_id, serving_model_id, min_tier)
          values (${f.servingModelId}, ${f.servingModelId}, 2)
        `,
      ).rejects.toThrow();
    });
  });

  it("allows only one grant per catalogue model", async () => {
    await inRollback(sql, async (tx) => {
      const f = await seed(tx);
      await expect(
        tx`
          insert into unlimited_entitlements (catalog_model_id, serving_model_id, min_tier)
          values (${f.catalogModelId}, ${f.servingModelId}, 2)
        `,
      ).rejects.toThrow();
    });
  });
});
