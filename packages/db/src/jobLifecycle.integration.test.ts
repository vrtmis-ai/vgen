import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGenerationRepository } from "./generationRepository";
import { PostgresJobRunnerRepository } from "./jobRunnerRepository";
import { PostgresQuotesRepository } from "./quotesRepository";
import { connect, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * What happens to the money when a generation finishes, against the real
 * ledger rather than a mocked one.
 *
 * Every test here starts from a genuine quote and a genuine submission, so the
 * balances it asserts on are the balances a customer would actually have. A
 * unit test with a stub repository can prove the runner calls `capture_hold`;
 * only this can prove that calling it leaves the books balanced, which is the
 * claim that matters.
 */

async function subscribe(tx: Sql, accountId: string, tier: number): Promise<void> {
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, max_concurrent_jobs)
    values (${`life-plan-${suffix}`}, 'Lifecycle Test Plan', ${tier}, 1000000, 10, 8)
    returning id
  `;
  await tx`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;
}

/** A priced variant the seeded catalogue really offers, and settings that price. */
async function paidVariant(tx: Sql): Promise<{ variantId: string; params: Record<string, string> }> {
  const [row] = await tx<{ variant_id: string; selector: Record<string, string> }[]>`
    select model.capabilities -> 'variant' ->> 'id' as variant_id, price.selector
    from provider_models model
    join model_prices price on price.provider_model_id = model.id
    where model.capabilities ? 'variant'
      and (model.capabilities -> 'family' ->> 'minTier')::int = 1
      and model.is_active and price.is_offered and price.valid_to is null
      and not exists (select 1 from unlimited_entitlements e where e.catalog_model_id = model.id and e.is_active)
    limit 1
  `;
  if (!row?.variant_id) throw new Error("the seeded catalogue has no priced tier-1 variant");
  return { variantId: row.variant_id, params: row.selector };
}

/**
 * A variant covered by an active unlimited grant.
 *
 * Throws rather than returning null when there is none. A test that quietly
 * returns early on an unseeded database is a test that passes without running,
 * and the granted path is the one thing here that nothing else covers — CI
 * seeds the grants before this suite for exactly that reason.
 */
async function grantedVariant(tx: Sql): Promise<{ variantId: string; minTier: number }> {
  const [row] = await tx<{ variant_id: string; min_tier: number }[]>`
    select model.capabilities -> 'variant' ->> 'id' as variant_id, ent.min_tier
    from unlimited_entitlements ent
    join provider_models model on model.id = ent.catalog_model_id
    where ent.is_active
    limit 1
  `;
  if (!row?.variant_id) throw new Error("no unlimited grant is seeded — run pnpm unlimited:publish first");
  return { variantId: row.variant_id, minTier: row.min_tier };
}

let keyCounter = 0;
const nextKey = () => `lifecycle-key-${Date.now()}-${keyCounter++}`;

/**
 * What the runner hands `succeed()` after mirroring: a file already in our
 * store, not a provider URL. The bucket and key are what `assets` records.
 */
function storedOutput(jobId: string, index = 0) {
  return {
    kind: "image" as const,
    mimeType: "image/png",
    bucket: "vgen",
    key: `generated/test/${jobId}/${index}.png`,
    byteSize: 2048,
    sha256: `sha-${jobId}-${index}`,
  };
}

interface Submitted {
  jobId: string;
  accountId: string;
  coins: number;
  startingCoins: number;
}

/** A funded account that has quoted and submitted a real paid generation. */
async function submitPaid(tx: Sql, startingCoins = 500): Promise<Submitted> {
  const { userId, accountId } = await makeUser(tx);
  await subscribe(tx, accountId, 3);
  await tx`select grant_credits(${accountId}, 'purchase', ${startingCoins * COIN})`;
  const { variantId, params } = await paidVariant(tx);

  const quote = await new PostgresQuotesRepository(tx).create({ userId, variantId, params });
  if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);

  const created = await new PostgresGenerationRepository(tx).createQueued({
    userId,
    quoteId: quote.quote.id,
    params,
    idempotencyKey: nextKey(),
  });
  if (created.outcome !== "created") throw new Error(`expected a job, got ${created.outcome}`);

  return { jobId: created.job.id, accountId, coins: quote.quote.coins, startingCoins };
}

async function balanceOf(tx: Sql, accountId: string) {
  const [row] = await tx<{ micro_credits: string; held_micro_credits: string }[]>`
    select micro_credits, held_micro_credits from account_balances where account_id = ${accountId}
  `;
  return { spendable: Number(row?.micro_credits ?? 0), held: Number(row?.held_micro_credits ?? 0) };
}

describe("claiming a job", () => {
  it("moves it to running and hands back what the runner needs to call the provider", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId } = await submitPaid(tx);
      const claimed = await new PostgresJobRunnerRepository(tx).claim(jobId);

      expect(claimed).not.toBeNull();
      expect(claimed!.providerCode).toBe("kie");
      expect(claimed!.externalModelId).toBeTruthy();
      expect(claimed!.attemptNo).toBe(1);
      expect(claimed!.holdId).not.toBeNull();

      const [job] = await tx<{ status: string; started_at: Date | null }[]>`
        select status, started_at from jobs where id = ${jobId}
      `;
      expect(job?.status).toBe("running");
      expect(job?.started_at).not.toBeNull();
    });
  });

  it("re-claims a job left running by a worker that died, rather than stranding it", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId } = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);

      const first = await runner.claim(jobId);
      const second = await runner.claim(jobId);

      // The second delivery is BullMQ redelivering a stalled job. If this
      // returned null the row would sit `running` forever with the customer's
      // coins held against it and nothing left to release them.
      expect(first!.attemptNo).toBe(1);
      expect(second!.attemptNo).toBe(2);
    });
  });

  it("refuses to re-claim a job that already finished", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId } = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);
      await runner.claim(jobId);
      await runner.succeed({
        jobId,
        outputs: [storedOutput(jobId)],
        providerUnitsCost: 1,
        providerCostUsd: 0.005,
      });

      expect(await runner.claim(jobId)).toBeNull();
    });
  });

  it("routes a granted job to the serving model, not the one the customer picked", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);
      const quote = await new PostgresQuotesRepository(tx).create({ userId, variantId: granted.variantId, params: {} });
      if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
      expect(quote.quote.coins).toBe(0);

      const created = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.quote.id,
        params: {},
        idempotencyKey: nextKey(),
      });
      if (created.outcome !== "created") throw new Error(`expected a job, got ${created.outcome}`);

      const claimed = await new PostgresJobRunnerRepository(tx).claim(created.job.id);

      // The catalogue row is KIE's and costs money; the grant says a different
      // provider runs it for free. Getting this backwards would quietly bill us
      // for every generation sold as unlimited.
      expect(claimed!.providerCode).toBe("useapi");
      expect(claimed!.entitlementId).not.toBeNull();
      expect(claimed!.holdId).toBeNull();
    });
  });
});

describe("settling a job that succeeded", () => {
  it("charges the quoted price, files the outputs, and leaves nothing held", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId, accountId, coins, startingCoins } = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);
      await runner.claim(jobId);

      await runner.succeed({
        jobId,
        outputs: [storedOutput(jobId)],
        providerUnitsCost: 0.8,
        providerCostUsd: 0.004,
      });

      const [job] = await tx<{ status: string; micro_credits_charged: string; output_count: number; provider_units_cost: string }[]>`
        select status, micro_credits_charged, output_count, provider_units_cost from jobs where id = ${jobId}
      `;
      expect(job?.status).toBe("succeeded");
      expect(Number(job?.micro_credits_charged)).toBe(coins * COIN);
      expect(job?.output_count).toBe(1);
      expect(Number(job?.provider_units_cost)).toBeCloseTo(0.8, 6);

      const [hold] = await tx<{ status: string }[]>`
        select status from credit_holds where ref_type = 'job' and ref_id = ${jobId}
      `;
      expect(hold?.status).toBe("captured");

      const balance = await balanceOf(tx, accountId);
      expect(balance.held).toBe(0);
      expect(balance.spendable).toBe((startingCoins - coins) * COIN);

      const [asset] = await tx<{ origin: string; storage_provider: string; storage_bucket: string; storage_key: string; sha256: string }[]>`
        select origin, storage_provider, storage_bucket, storage_key, sha256 from assets where job_id = ${jobId}
      `;
      // In our own bucket, not pointing at the provider. A provider URL expires
      // and takes the customer's gallery with it.
      expect(asset).toMatchObject({ origin: "generated", storage_provider: "s3", storage_bucket: "vgen" });
      expect(asset?.storage_key).toContain(jobId);
      expect(asset?.sha256).toBeTruthy();
    });
  });

  it("does not charge twice when the same completion arrives twice", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId, accountId, coins, startingCoins } = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);
      await runner.claim(jobId);
      const outputs = [storedOutput(jobId)];

      await runner.succeed({ jobId, outputs, providerUnitsCost: 0.8, providerCostUsd: 0.004 });
      await runner.succeed({ jobId, outputs, providerUnitsCost: 0.8, providerCostUsd: 0.004 });

      const balance = await balanceOf(tx, accountId);
      expect(balance.spendable).toBe((startingCoins - coins) * COIN);
      const [assets] = await tx<{ count: string }[]>`select count(*)::text as count from assets where job_id = ${jobId}`;
      expect(Number(assets?.count)).toBe(1);
    });
  });
});

describe("settling a job that failed", () => {
  it("gives every coin back — a user must never pay for a generation they did not get", async () => {
    await inRollback(sql, async (tx) => {
      const { jobId, accountId, startingCoins } = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);
      await runner.claim(jobId);

      await runner.fail(jobId, "content_policy", "Prompt rejected.");

      const [job] = await tx<{ status: string; error_code: string; micro_credits_charged: string }[]>`
        select status, error_code, micro_credits_charged from jobs where id = ${jobId}
      `;
      expect(job?.status).toBe("failed");
      expect(job?.error_code).toBe("content_policy");
      expect(Number(job?.micro_credits_charged)).toBe(0);

      const [hold] = await tx<{ status: string }[]>`
        select status from credit_holds where ref_type = 'job' and ref_id = ${jobId}
      `;
      expect(hold?.status).toBe("released");

      const balance = await balanceOf(tx, accountId);
      expect(balance.held).toBe(0);
      // Exactly what they started with. Not approximately.
      expect(balance.spendable).toBe(startingCoins * COIN);

      const [lot] = await tx<{ micro_credits_remaining: string }[]>`
        select micro_credits_remaining from credit_lots where account_id = ${accountId}
      `;
      expect(Number(lot?.micro_credits_remaining)).toBe(startingCoins * COIN);
    });
  });

  it("gives a granted job its slice of the day back", async () => {
    await inRollback(sql, async (tx) => {
      const granted = await grantedVariant(tx);
      const { userId, accountId } = await makeUser(tx);
      await subscribe(tx, accountId, granted.minTier);
      const quotes = new PostgresQuotesRepository(tx);

      const quote = await quotes.create({ userId, variantId: granted.variantId, params: {} });
      if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
      const before = quote.quote.unlimited?.remainingToday ?? null;

      const created = await new PostgresGenerationRepository(tx).createQueued({
        userId,
        quoteId: quote.quote.id,
        params: {},
        idempotencyKey: nextKey(),
      });
      if (created.outcome !== "created") throw new Error(`expected a job, got ${created.outcome}`);

      const runner = new PostgresJobRunnerRepository(tx);
      await runner.claim(created.job.id);
      await runner.fail(created.job.id, "provider_unavailable", "No adapter.");

      const after = await quotes.create({ userId, variantId: granted.variantId, params: {} });
      if (after.outcome !== "quoted") throw new Error(`expected a quote, got ${after.outcome}`);

      // A provider failure is not a use. Without the release the customer
      // silently loses one of a fixed number of free generations a day.
      expect(after.quote.unlimited?.remainingToday ?? null).toBe(before);
    });
  });

  it("leaves the ledger balanced, which is what the reconciliation view checks", async () => {
    await inRollback(sql, async (tx) => {
      const succeeded = await submitPaid(tx);
      const failed = await submitPaid(tx);
      const runner = new PostgresJobRunnerRepository(tx);

      await runner.claim(succeeded.jobId);
      await runner.succeed({
        jobId: succeeded.jobId,
        outputs: [storedOutput(succeeded.jobId)],
        providerUnitsCost: 1,
        providerCostUsd: 0.005,
      });
      await runner.claim(failed.jobId);
      await runner.fail(failed.jobId, "provider_timeout", "No result in time.");

      // 0004's three drift views each return rows only when something is wrong:
      // the cached balance against the ledger sum, each ledger row's running
      // snapshot, and the lots against what the account can spend. All three
      // empty is the whole claim — a capture or a release that updated one of
      // those and not the others is the failure you otherwise find months later.
      const accounts = [succeeded.accountId, failed.accountId];
      const balanceDrift = await tx`select account_id from v_balance_drift where account_id in ${tx(accounts)}`;
      const lotDrift = await tx`select account_id from v_lot_drift where account_id in ${tx(accounts)}`;
      const continuityBreaks = await tx`select id from v_ledger_continuity_breaks where account_id in ${tx(accounts)}`;

      expect(balanceDrift).toHaveLength(0);
      expect(lotDrift).toHaveLength(0);
      expect(continuityBreaks).toHaveLength(0);
    });
  });
});

describe("the credential pool", () => {
  it("hands out a different account each time, so one is not hammered while others idle", async () => {
    await inRollback(sql, async (tx) => {
      const [provider] = await tx<{ id: string }[]>`select id from providers where code = 'useapi'`;
      if (!provider) throw new Error("the useapi provider is not seeded — run pnpm unlimited:publish first");

      const runner = new PostgresJobRunnerRepository(tx);
      const picks = [
        await runner.pickCredential(provider!.id),
        await runner.pickCredential(provider!.id),
        await runner.pickCredential(provider!.id),
      ];

      expect(picks.every((pick) => pick !== null)).toBe(true);
      expect(new Set(picks.map((pick) => pick!.id)).size).toBe(3);
      // The pointer into the environment, never the token itself.
      expect(picks[0]!.secretRef).toMatch(/^USEAPI_/);
    });
  });

  it("returns nothing for a provider with no credentials, rather than an empty-looking one", async () => {
    await inRollback(sql, async (tx) => {
      const [provider] = await tx<{ id: string }[]>`
        insert into providers (code, name) values (${`ghost-${Date.now()}`}, 'Ghost') returning id
      `;
      expect(await new PostgresJobRunnerRepository(tx).pickCredential(provider!.id)).toBeNull();
    });
  });
});
