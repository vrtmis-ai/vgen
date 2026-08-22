import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGenerationRepository } from "./generationRepository";
import { PostgresQuotesRepository } from "./quotesRepository";
import { COIN } from "./integrationHarness";
import { available, bothOf, connectPool, inFlight, outcomesOf, resetAccount, sharedAccount, type RaceAccount } from "./raceHarness";

/**
 * What happens when two submissions arrive at once.
 *
 * Everything else in `packages/db` is tested through `inRollback` on a single
 * connection, which is the right default and cannot express any of this — see
 * `raceHarness.ts`. These commit, and they run on separate connections, because
 * the bugs they are looking for are all the same shape: a decision made from a
 * count that another uncommitted transaction is about to invalidate.
 *
 * Run them repeatedly. `pnpm --filter @vgen/db test:integration --repeat 20`.
 * A race that passes once has proved nothing, and two of these were written by
 * first making them fail.
 */

let pool: Sql;

beforeAll(() => {
  pool = connectPool(6);
});
afterAll(async () => {
  await pool.end();
});

let keyCounter = 0;
const nextKey = () => `race-key-${Date.now()}-${keyCounter++}`;

/** A paid variant the seeded catalogue has, with settings that price. */
async function paidVariant(sql: Sql): Promise<{ variantId: string; params: Record<string, string> }> {
  const [row] = await sql<{ variant_id: string; selector: Record<string, string> }[]>`
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

async function quoteFor(sql: Sql, account: RaceAccount) {
  const { variantId, params } = await paidVariant(sql);
  const quote = await new PostgresQuotesRepository(sql).create({ userId: account.userId, variantId, params });
  if (quote.outcome !== "quoted") throw new Error(`expected a quote, got ${quote.outcome}`);
  return { params, quote: quote.quote };
}

/**
 * An account reset to a known state, holding one live quote.
 *
 * `concurrency` defaults to a limit of one, because that is the number every
 * off-by-one here is about: with a limit of eight, two submissions racing past
 * the check both land inside the allowance and prove nothing.
 */
async function ready(slot: string, options: { concurrency?: number; coins?: number } = {}) {
  const account = await sharedAccount(pool, slot);
  await resetAccount(pool, account, { concurrency: options.concurrency ?? 1, ...options });
  const quoted = await quoteFor(pool, account);
  return { ...account, ...quoted };
}

describe("two submissions at once", () => {
  it("keeps two accounts' jobs entirely separate", async () => {
    const one = await ready("iso-a", { concurrency: 4 });
    const two = await ready("iso-b", { concurrency: 4 });

    const submit = (who: typeof one) =>
      new PostgresGenerationRepository(pool).createQueued({
        userId: who.userId,
        quoteId: who.quote.id,
        params: who.params,
        idempotencyKey: nextKey(),
      });

    const [a, b] = await bothOf(
      () => submit(one),
      () => submit(two),
    );

    expect(outcomesOf([a, b])).toEqual(["created", "created"]);
    if (!a.ok || !b.ok || a.value.outcome !== "created" || b.value.outcome !== "created") return;

    // The thing that would be catastrophic and silent: A charged for B's
    // generation. Read back from the row rather than from the return value,
    // because the return value is what the buggy version would also say.
    const rows = await pool<{ id: string; account_id: string; created_by: string }[]>`
      select id, account_id, created_by from jobs where id in (${a.value.job.id}, ${b.value.job.id})
    `;
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(a.value.job.id)?.account_id).toBe(one.accountId);
    expect(byId.get(a.value.job.id)?.created_by).toBe(one.userId);
    expect(byId.get(b.value.job.id)?.account_id).toBe(two.accountId);
    expect(byId.get(b.value.job.id)?.created_by).toBe(two.userId);

    // And each hold came out of its own account's lots.
    expect(await inFlight(pool, one.accountId)).toBe(1);
    expect(await inFlight(pool, two.accountId)).toBe(1);
  });

  it("turns one quote into one job, however many requests arrive for it", async () => {
    const account = await ready("quote", { concurrency: 4 });

    const submit = () =>
      new PostgresGenerationRepository(pool).createQueued({
        userId: account.userId,
        quoteId: account.quote.id,
        params: account.params,
        // Different keys: with the same key this would be a replay, which is a
        // different mechanism and is the test below.
        idempotencyKey: nextKey(),
      });

    const [a, b] = await bothOf(submit, submit);

    // Exactly one job, whatever the loser was told. A quote is a price we
    // committed to once.
    expect(await inFlight(pool, account.accountId)).toBe(1);

    const outcomes = outcomesOf([a, b]);
    expect(outcomes).toContain("created");
    // The loser must lose *cleanly*. `jobs_quote_idx` makes a second job on one
    // quote impossible at the storage layer, but a unique violation escaping
    // `createQueued` is a 500 on a request the caller could have been told
    // "already submitted" about.
    expect(outcomes.filter((outcome) => outcome.startsWith("threw:"))).toEqual([]);
    expect(outcomes).toEqual(["created", "quote_spent"]);
  });

  it("returns the same job to a request replayed at the same moment", async () => {
    const account = await ready("replay", { concurrency: 4 });
    const key = nextKey();

    const submit = () =>
      new PostgresGenerationRepository(pool).createQueued({
        userId: account.userId,
        quoteId: account.quote.id,
        params: account.params,
        idempotencyKey: key,
      });

    const [a, b] = await bothOf(submit, submit);

    expect(await inFlight(pool, account.accountId)).toBe(1);
    expect(outcomesOf([a, b]).filter((outcome) => outcome.startsWith("threw:"))).toEqual([]);
    // One created it and the other was handed it back. A client that retried a
    // request whose response it never saw is owed the first job, not a second
    // charge for the same picture.
    expect(outcomesOf([a, b])).toEqual(["created", "replayed"]);
    if (a.ok && b.ok && "job" in a.value && "job" in b.value) {
      expect(a.value.job.id).toBe(b.value.job.id);
    }
  });

  /**
   * The one this suite was written for.
   *
   * `concurrencyForTx` counts jobs in `queued` and `running` and takes no lock
   * on the account. Under READ COMMITTED, a transaction that has inserted a job
   * but not committed is invisible to everyone else — so two submissions on
   * *different* quotes can both read `running = 0`, both pass a limit of one,
   * and both insert.
   *
   * Written as an explicit sequence rather than as two parallel calls, because
   * a race reproduced by timing is a race that stops reproducing on a faster
   * machine. Holding the first transaction open with a gate makes the anomaly
   * deterministic: the second submission is *guaranteed* to be reading from
   * before the first one's insert, which is precisely the window the bug lives
   * in.
   */
  it("does not let two submissions past a limit of one", async () => {
    const account = await sharedAccount(pool, "limit");
    await resetAccount(pool, account, { concurrency: 1 });
    const first = await quoteFor(pool, account);
    const second = await quoteFor(pool, account);

    let openTheGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openTheGate = resolve;
    });
    let firstOutcome = "";

    const held = pool.begin(async (tx) => {
      const result = await new PostgresGenerationRepository(tx as unknown as Sql).createQueued({
        userId: account.userId,
        quoteId: first.quote.id,
        params: first.params,
        idempotencyKey: nextKey(),
      });
      firstOutcome = result.outcome;
      // Inserted, not committed. This is the state a second request has to
      // survive, and the one no single-connection harness can produce.
      await gate;
      return result;
    });

    while (firstOutcome === "") await new Promise((resolve) => setTimeout(resolve, 10));
    expect(firstOutcome).toBe("created");

    const racing = new PostgresGenerationRepository(pool).createQueued({
      userId: account.userId,
      quoteId: second.quote.id,
      params: second.params,
      idempotencyKey: nextKey(),
    });

    // Long enough for the second submission to have reached whatever it is
    // going to block on. It is not load-bearing for correctness — the
    // assertions below hold whenever it commits — only for the race being
    // exercised at all.
    await new Promise((resolve) => setTimeout(resolve, 250));
    openTheGate();

    await held;
    const second_ = await racing;

    // One job in flight, because the plan says one.
    expect(await inFlight(pool, account.accountId)).toBe(1);
    expect(second_.outcome).toBe("concurrency_reached");
  });

  it("gives every coin back when concurrent jobs all fail", async () => {
    const account = await sharedAccount(pool, "refund");
    await resetAccount(pool, account, { concurrency: 5 });
    const before = await available(pool, account.accountId);

    const quotes = [];
    for (let i = 0; i < 4; i += 1) quotes.push(await quoteFor(pool, account));

    const submissions = await Promise.all(
      quotes.map((held) =>
        new PostgresGenerationRepository(pool).createQueued({
          userId: account.userId,
          quoteId: held.quote.id,
          params: held.params,
          idempotencyKey: nextKey(),
        }),
      ),
    );
    const jobIds = submissions.flatMap((result) => (result.outcome === "created" ? [result.job.id] : []));
    expect(jobIds).toHaveLength(4);

    // Held, so the coins are out of the lots but not spent.
    const during = await available(pool, account.accountId);
    expect(during).toBeLessThan(before);

    // All four refused at once, which is what a provider outage looks like.
    await Promise.all(
      jobIds.map((jobId) => pool`select release_hold((select id from credit_holds where ref_type = 'job' and ref_id = ${jobId}::uuid))`),
    );
    await pool`update jobs set status = 'failed' where id in ${pool(jobIds)}`;

    // Exactly back, not approximately: a lost refund and a double refund are
    // both silent, and both are somebody else's money.
    expect(await available(pool, account.accountId)).toBe(before);
    expect(await inFlight(pool, account.accountId)).toBe(0);

    const [ledger] = await pool<{ holds: string; releases: string }[]>`
      select
        count(*) filter (where entry_type = 'hold')::text as holds,
        count(*) filter (where entry_type = 'release')::text as releases
      from credit_ledger
      where account_id = ${account.accountId} and ref_type = 'job' and ref_id in ${pool(jobIds)}
    `;
    expect(ledger?.holds).toBe("4");
    expect(ledger?.releases).toBe("4");
  });
});

/** Sanity: the fixture really is a paid model, or every test above is vacuous. */
it("prices the variant these tests submit", async () => {
  const account = await sharedAccount(pool, "price-check");
  await resetAccount(pool, account, { concurrency: 1 });
  const { quote } = await quoteFor(pool, account);
  expect(quote.coins).toBeGreaterThan(0);
  expect(quote.coins * COIN).toBeGreaterThan(0);
});
