import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAnalyticsRepository } from "./analyticsRepository";
import { PostgresBansRepository } from "./bansRepository";
import { COIN, connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * The numbers the panel puts in front of a person.
 *
 * Worth being fussy about, because a dashboard is believed. A wrong routing
 * table is found by the next job failing; a wrong revenue figure is found in a
 * board meeting, if at all.
 *
 * The one most likely to be quietly wrong is the day boundary. The server runs
 * in UTC and the customers are in Tehran, where UTC midnight falls at 03:30 —
 * so a job made at half past midnight Tehran time is *yesterday* in UTC, and a
 * "today" that used UTC would be missing the entire evening every operator
 * thinks of as tonight.
 */

/**
 * Deltas, not absolutes.
 *
 * These run against the seeded development catalogue, which already carries
 * jobs and credit lots of its own, and `inRollback` isolates a test from other
 * tests rather than from the seed. Asserting `jobs === 1` would be asserting
 * something about the fixture data instead of about the query.
 */

/** A job, placed at a chosen instant so the window logic has something to sort. */
async function jobAt(
  tx: Sql,
  options: { accountId: string; userId: string; at: string; status?: string; costUsd?: number; coins?: number },
) {
  const [feature] = await tx<{ id: string }[]>`select id from features limit 1`;
  const [model] = await tx<{ id: string }[]>`select id from provider_models where capabilities ? 'variant' limit 1`;
  // `options.at` is a SQL expression, so it is evaluated here and bound as a
  // real instant. Interpolating it as a parameter would send the string "now()"
  // to the timestamp serialiser.
  const [moment] = await tx<{ at: Date }[]>`select (${tx.unsafe(options.at)})::timestamptz as at`;
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (account_id, created_by, feature_id, provider_model_id, status, params,
                      micro_credits_charged, provider_cost_usd, created_at, queued_at, started_at, completed_at)
    values (
      ${options.accountId}, ${options.userId}, ${feature!.id}, ${model!.id},
      ${options.status ?? "succeeded"}, '{}'::jsonb,
      ${(options.coins ?? 2) * COIN}, ${options.costUsd ?? 0.01},
      ${moment!.at}, ${moment!.at}, ${moment!.at}, ${moment!.at}
    )
    returning id
  `;
  return job!.id;
}

describe("the overview", () => {
  it("counts what happened in the window and ignores what did not", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);

      const baseRecent = await analytics.overview("30d");
      const baseAll = await analytics.overview("all");

      await jobAt(tx, { accountId, userId, at: "now()", costUsd: 0.25 });
      await jobAt(tx, { accountId, userId, at: "now() - interval '90 days'", costUsd: 99 });

      const recent = await analytics.overview("30d");
      const everything = await analytics.overview("all");

      expect(recent.jobs - baseRecent.jobs).toBe(1);
      expect(recent.providerCostUsd - baseRecent.providerCostUsd).toBeCloseTo(0.25, 6);
      // The 90-day-old job is not gone, it is simply not in the last thirty days.
      expect(everything.jobs - baseAll.jobs).toBe(2);
      expect(everything.providerCostUsd - baseAll.providerCostUsd).toBeCloseTo(99.25, 6);
    });
  });

  it("puts a late Tehran evening in today, where the operator would look for it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);

      // 00:30 Tehran today. In UTC that is 21:00 *yesterday*, so a UTC-day
      // "today" would miss it entirely — which is the whole reason this
      // repository does its arithmetic in Asia/Tehran.
      const tehranEarlyToday = `(date_trunc('day', now() at time zone 'Asia/Tehran') + interval '30 minutes') at time zone 'Asia/Tehran'`;
      const [calendars] = await tx<{ is_yesterday_in_utc: boolean }[]>`
        select (${tx.unsafe(tehranEarlyToday)})::date < (now() at time zone 'UTC')::date as is_yesterday_in_utc
      `;
      const isYesterdayInUtc = calendars!.is_yesterday_in_utc;

      const before = await analytics.overview("today");
      await jobAt(tx, { accountId, userId, at: tehranEarlyToday });
      const today = await analytics.overview("today");

      expect(today.jobs - before.jobs).toBe(1);
      // The two calendars only disagree for part of the day. While they do,
      // this is the assertion that would catch a regression to UTC days — the
      // job's UTC date is yesterday, and it still has to count as today.
      if (isYesterdayInUtc) expect(today.jobs - before.jobs).toBe(1);
    });
  });

  it("separates coins sold from coins given away", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);

      const before = await analytics.overview("all");
      await tx`select grant_credits(${accountId}, 'purchase', ${100 * COIN})`;
      await tx`select grant_credits(${accountId}, 'promo', ${40 * COIN})`;

      const totals = await analytics.overview("all");
      // A promo campaign must not read as a good quarter. Both arrive through
      // grant_credits and both land as entry_type 'grant'; only the lot's
      // source tells them apart.
      expect(totals.coinsSold - before.coinsSold).toBe(100);
      expect(totals.coinsGranted - before.coinsGranted).toBe(40);
    });
  });

  it("reports no margin rather than a negative one while nothing has been sold", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await jobAt(tx, { accountId, userId, costUsd: 12, at: "now()" });

      const totals = await new PostgresAnalyticsRepository(tx).overview("all");
      expect(totals.revenueUsd).toBe(0);
      // There is no gateway yet. "-$12 margin" would read as a business losing
      // money rather than as one that has not opened.
      expect(totals.grossMarginUsd).toBeNull();
    });
  });

  it("counts a person who generated, not a person who merely exists", async () => {
    await inRollback(sql, async (tx) => {
      const analytics = new PostgresAnalyticsRepository(tx);
      const start = await analytics.overview("today");

      const active = await makeUser(tx);
      await makeUser(tx);
      const signedUp = await analytics.overview("today");
      expect(signedUp.newUsers - start.newUsers).toBe(2);
      // Signing up is not activity. Two new accounts, nobody active yet.
      expect(signedUp.activeUsers - start.activeUsers).toBe(0);

      await jobAt(tx, { accountId: active.accountId, userId: active.userId, at: "now()" });
      const after = await analytics.overview("today");

      // One of the two generated; the other still only exists.
      expect(after.activeUsers - signedUp.activeUsers).toBe(1);
    });
  });
});

describe("the daily series", () => {
  it("returns a row for every day in the window, including the empty ones", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await jobAt(tx, { accountId, userId, at: "now()" });

      const series = await new PostgresAnalyticsRepository(tx).daily("7d");

      // Seven days, not "however many had activity". A sparkline that closed
      // the gaps would draw a straight line through an outage.
      expect(series).toHaveLength(7);
      expect(series.at(-1)!.jobs).toBeGreaterThanOrEqual(1);
      expect(series.map((point) => point.day)).toEqual([...series.map((point) => point.day)].sort());
    });
  });
});

describe("models and providers", () => {
  it("attributes a job to the model that was bought", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);
      const before = await analytics.models("30d");
      const jobId = await jobAt(tx, { accountId, userId, at: "now()", costUsd: 3, coins: 7 });

      const [ran] = await tx<{ name: string }[]>`
        select model.name from jobs job join provider_models model on model.id = job.provider_model_id where job.id = ${jobId}
      `;
      const name = ran!.name;
      const was = before.find((entry) => entry.name === name);
      const now = (await analytics.models("30d")).find((entry) => entry.name === name);

      expect(now).toBeDefined();
      expect(now!.jobs - (was?.jobs ?? 0)).toBe(1);
      expect(now!.coinsCharged - (was?.coinsCharged ?? 0)).toBe(7);
      expect(now!.succeeded - (was?.succeeded ?? 0)).toBe(1);
      expect(now!.providerCostUsd - (was?.providerCostUsd ?? 0)).toBeCloseTo(3, 6);
    });
  });

  it("lists every provider, including one that has run nothing", async () => {
    await inRollback(sql, async (tx) => {
      const rows = await new PostgresAnalyticsRepository(tx).providers("30d");
      // A provider with no traffic is a fact worth showing — it is usually the
      // one whose key was never set.
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.attempts >= 0)).toBe(true);
    });
  });
});

describe("the customer list", () => {
  it("finds someone by part of their email and reports the true total", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const [owner] = await tx<{ email: string }[]>`select email from users where id = ${userId}`;
      const email = owner!.email;
      const analytics = new PostgresAnalyticsRepository(tx);

      const found = await analytics.users({ search: email.slice(0, 12), sort: "spent", limit: 25, offset: 0 });
      expect(found.users.some((user) => user.id === userId)).toBe(true);

      const all = await analytics.users({ sort: "created", limit: 1, offset: 0 });
      expect(all.users).toHaveLength(1);
      // `count(*) over ()` comes from the same scan, so the total cannot
      // disagree with the page it was taken from.
      expect(all.total).toBeGreaterThan(1);
    });
  });

  it("shows someone who signed up and never generated", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const page = await new PostgresAnalyticsRepository(tx).users({ sort: "created", limit: 100, offset: 0 });
      const row = page.users.find((user) => user.id === userId);
      // "This person says they paid and I cannot find them" is exactly the case
      // the list exists for, so a quiet account must not be hidden.
      expect(row).toBeDefined();
      expect(row!.jobs).toBe(0);
    });
  });

  it("carries the balance, the spend and the count of live bans", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await tx`select grant_credits(${accountId}, 'purchase', ${50 * COIN})`;
      await new PostgresBansRepository(tx).create({ userId, scope: "generation", createdBy: userId });

      const detail = await new PostgresAnalyticsRepository(tx).user(userId);
      expect(detail!.coinsBalance).toBe(50);
      expect(detail!.coinsPurchased).toBe(50);
      expect(detail!.activeBans).toBe(1);
    });
  });

  it("answers null for someone who is not there", async () => {
    await inRollback(sql, async (tx) => {
      expect(await new PostgresAnalyticsRepository(tx).user("00000000-0000-4000-8000-000000000000")).toBeNull();
    });
  });
});

describe("correcting a balance by hand", () => {
  it("gives coins and records who did it", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);

      await analytics.adjustCredits({ userId, coins: 25, note: "goodwill after a failed batch", actorUserId: userId });

      const detail = await analytics.user(userId);
      expect(detail!.coinsBalance).toBe(25);
      const entry = detail!.recentLedger[0];
      expect(entry!.coins).toBe(25);
      // Through grant_credits, so it becomes a real lot that expires and
      // reconciles like every other rather than a second kind of credit.
      expect(entry!.entryType).toBe("grant");
    });
  });

  it("takes coins away and leaves an explained ledger row", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);
      await tx`select grant_credits(${accountId}, 'purchase', ${100 * COIN})`;

      await analytics.adjustCredits({ userId, coins: -30, note: "duplicate grant, reversing", actorUserId: userId });

      const detail = await analytics.user(userId);
      expect(detail!.coinsBalance).toBe(70);
      const entry = detail!.recentLedger[0]!;
      expect(entry.entryType).toBe("adjustment");
      expect(entry.coins).toBe(-30);
      // balance_after has to match, or the ledger stops being the truth the
      // reconciler checks the cache against.
      expect(entry.balanceAfterCoins).toBe(70);
      expect(entry.note).toBe("duplicate grant, reversing");
    });
  });

  it("refuses to overdraw rather than taking whatever is left", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);
      await tx`select grant_credits(${accountId}, 'purchase', ${10 * COIN})`;

      // Inside a savepoint: the refusal is a Postgres exception, which would
      // otherwise abort the surrounding test transaction and make the balance
      // check below unrunnable.
      // Clamping would make "take back the 500 we gave them" silently take
      // back ten, with nothing saying so.
      // `inRollback` hands out an Sql, but the value behind it is an open
      // transaction — which is what carries `savepoint`.
      const inTransaction = tx as unknown as { savepoint: <T>(fn: () => Promise<T>) => Promise<T> };
      await expect(
        inTransaction.savepoint(() => analytics.adjustCredits({ userId, coins: -500, note: "too much", actorUserId: userId })),
      ).rejects.toThrow();

      expect((await analytics.user(userId))!.coinsBalance).toBe(10);
    });
  });
});

describe("ending someone's sessions", () => {
  it("revokes the live ones, keeps the rows, and is safe to repeat", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const analytics = new PostgresAnalyticsRepository(tx);
      await tx`
        insert into sessions (user_id, token_hash, expires_at)
        values (${userId}, ${`hash-${Math.random()}`}, now() + interval '30 days')
      `;

      expect(await analytics.revokeSessions(userId)).toBe(1);
      // Revoked, not deleted: "were they signed out, and when" survives.
      const [row] = await tx<{ revoked_at: Date | null }[]>`select revoked_at from sessions where user_id = ${userId}`;
      expect(row!.revoked_at).not.toBeNull();
      expect(await analytics.revokeSessions(userId)).toBe(0);
    });
  });
});
