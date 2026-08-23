import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * The two analytics tables that existed and were never written to.
 *
 * `events` is filled by a trigger, so what these tests really assert is that no
 * application path can forget it — every row here is written by an INSERT or an
 * UPDATE to `jobs` and by nothing else. `usage_daily` is filled by a scheduled
 * recompute, so what matters there is that running it twice is the same as
 * running it once, and that a late completion corrects a day that was already
 * rolled up.
 */

async function anyVariant(tx: Sql) {
  const [row] = await tx<{ id: string; feature_id: string }[]>`
    select model.id, route.feature_id
    from provider_models model
    join feature_model_routes route on route.provider_model_id = model.id
    join features feature on feature.id = route.feature_id
    where model.capabilities ? 'variant' and model.is_active and feature.modality = 'image'
    limit 1
  `;
  if (!row) throw new Error("the seeded catalogue has no active image variant");
  return row;
}

async function insertJob(
  tx: Sql,
  options: { accountId: string; userId: string; status?: string; charged?: number; cost?: string; outputs?: number; daysAgo?: number },
): Promise<string> {
  const model = await anyVariant(tx);
  const [job] = await tx<{ id: string }[]>`
    insert into jobs (
      account_id, created_by, feature_id, provider_model_id, params, status, origin,
      micro_credits_held, micro_credits_charged, provider_cost_usd, output_count, created_at
    ) values (
      ${options.accountId}, ${options.userId}, ${model.feature_id}, ${model.id},
      ${tx.json({ prompt: "a small red boat" })}, ${options.status ?? "queued"}, 'web',
      ${2 * COIN}, ${options.charged ?? 0}, ${options.cost ?? "0"}, ${options.outputs ?? 0},
      ${tx`now() - ${options.daysAgo ?? 0} * interval '1 day'`}
    )
    returning id
  `;
  return job!.id;
}

const eventsFor = (tx: Sql, jobId: string) =>
  tx<{ name: string; account_id: string; user_id: string; properties: Record<string, unknown> }[]>`
    select name, account_id, user_id, properties from events
    where properties ->> 'jobId' = ${jobId}
    order by occurred_at
  `;

describe("what happened, written where it cannot be forgotten", () => {
  it("records a submission the moment a job is inserted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId });

      const events = await eventsFor(tx, jobId);

      expect(events.map((event) => event.name)).toEqual(["job.submitted"]);
      expect(events[0]?.account_id).toBe(accountId);
      expect(events[0]?.user_id).toBe(userId);
      expect(events[0]?.properties["origin"]).toBe("web");
    });
  });

  it("says nothing about a draft, and calls it a submission when it is sent", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId, status: "draft" });

      // A draft is a row somebody may never send. It is not usage and it is not
      // an event.
      expect(await eventsFor(tx, jobId)).toHaveLength(0);

      await tx`update jobs set status = 'queued' where id = ${jobId}`;

      expect((await eventsFor(tx, jobId)).map((event) => event.name)).toEqual(["job.submitted"]);
    });
  });

  it("follows a job to whichever end it reaches", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const won = await insertJob(tx, { accountId, userId });
      const lost = await insertJob(tx, { accountId, userId });

      await tx`update jobs set status = 'running' where id in (${won}, ${lost})`;
      await tx`update jobs set status = 'succeeded', output_count = 2 where id = ${won}`;
      await tx`update jobs set status = 'failed', error_code = 'provider_refused' where id = ${lost}`;

      // 'running' is the provider picking the work up. It answers no question
      // anyone asks of this table, so it is not an event.
      expect((await eventsFor(tx, won)).map((event) => event.name)).toEqual(["job.submitted", "job.succeeded"]);
      const failed = await eventsFor(tx, lost);
      expect(failed.map((event) => event.name)).toEqual(["job.submitted", "job.failed"]);
      expect(failed[1]?.properties["errorCode"]).toBe("provider_refused");
    });
  });

  /**
   * `UPDATE OF status` fires on any write that names the column, including one
   * that sets it to what it already was. Without the transition guard, a
   * redelivered provider callback would write a second `job.succeeded` that
   * nobody could tell from the first.
   */
  it("writes nothing when a status is set to what it already was", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId });
      await tx`update jobs set status = 'succeeded' where id = ${jobId}`;

      await tx`update jobs set status = 'succeeded', output_count = 3 where id = ${jobId}`;
      await tx`update jobs set status = 'succeeded' where id = ${jobId}`;

      expect((await eventsFor(tx, jobId)).filter((event) => event.name === "job.succeeded")).toHaveLength(1);
    });
  });

  /**
   * The same rule the catalogue and the job error already follow. This table is
   * read by staff, and it is also the one most likely to be exported somewhere
   * with looser access than the database has.
   */
  it("names our catalogue row and never the supplier", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId });

      const [event] = await eventsFor(tx, jobId);

      expect(Object.keys(event!.properties).sort()).toEqual([
        "errorCode",
        "featureId",
        "jobId",
        "microCredits",
        "origin",
        "outputs",
        "providerModelId",
      ]);
      expect(JSON.stringify(event!.properties)).not.toMatch(/kie|wavespeed|useapi|aiquickdraw/i);
    });
  });
});

const usageFor = (tx: Sql, accountId: string) =>
  tx<
    {
      day: string;
      job_count: number;
      success_count: number;
      failure_count: number;
      micro_credits_charged: string;
      provider_cost_usd: string;
      output_assets: number;
    }[]
  >`
    select day, job_count, success_count, failure_count, micro_credits_charged, provider_cost_usd, output_assets
    from usage_daily where account_id = ${accountId} order by day
  `;

describe("what it added up to", () => {
  it("counts the day's jobs, its successes and its failures apart", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const done = await insertJob(tx, { accountId, userId });
      const broke = await insertJob(tx, { accountId, userId });
      const gone = await insertJob(tx, { accountId, userId });
      await insertJob(tx, { accountId, userId }); // still queued
      await tx`update jobs set status = 'succeeded', micro_credits_charged = ${3 * COIN}, provider_cost_usd = 0.14, output_count = 2 where id = ${done}`;
      await tx`update jobs set status = 'failed' where id = ${broke}`;
      await tx`update jobs set status = 'cancelled' where id = ${gone}`;

      await tx`select roll_up_usage_daily(3)`;
      const [row] = await usageFor(tx, accountId);

      expect(row?.job_count).toBe(4);
      expect(row?.success_count).toBe(1);
      // Cancelled is not a failure. Nobody was charged and nothing went wrong;
      // counting it would make the failure rate a measure of how often people
      // change their minds.
      expect(row?.failure_count).toBe(1);
      expect(row?.micro_credits_charged).toBe(String(3 * COIN));
      expect(Number(row?.provider_cost_usd)).toBeCloseTo(0.14, 6);
      expect(row?.output_assets).toBe(2);
    });
  });

  it("leaves drafts out, because a draft was never submitted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      await insertJob(tx, { accountId, userId, status: "draft" });

      await tx`select roll_up_usage_daily(3)`;

      expect(await usageFor(tx, accountId)).toHaveLength(0);
    });
  });

  /**
   * The property the whole design rests on. The rollup is scheduled nightly and
   * recomputes a window rather than adding to it, so a second run — a retry, an
   * operator running it by hand, cron firing twice — must not double anything.
   */
  it("adds up to the same numbers however many times it runs", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId });
      await tx`update jobs set status = 'succeeded', micro_credits_charged = ${2 * COIN}, output_count = 1 where id = ${jobId}`;

      await tx`select roll_up_usage_daily(3)`;
      const first = await usageFor(tx, accountId);
      await tx`select roll_up_usage_daily(3)`;
      await tx`select roll_up_usage_daily(3)`;

      expect(await usageFor(tx, accountId)).toEqual(first);
      expect(first[0]?.job_count).toBe(1);
    });
  });

  /**
   * A job submitted at 23:59 finishes on the next day, after that day's rollup
   * has already run and written a zero. An incremental counter would carry that
   * error forever; a recompute corrects it on the next pass, and this is what
   * says so.
   */
  it("corrects a day after a job finishes late", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const jobId = await insertJob(tx, { accountId, userId, daysAgo: 1 });
      await tx`select roll_up_usage_daily(3)`;
      expect((await usageFor(tx, accountId))[0]?.micro_credits_charged).toBe("0");

      await tx`update jobs set status = 'succeeded', micro_credits_charged = ${5 * COIN} where id = ${jobId}`;
      await tx`select roll_up_usage_daily(3)`;

      const [row] = await usageFor(tx, accountId);
      expect(row?.micro_credits_charged).toBe(String(5 * COIN));
      expect(row?.success_count).toBe(1);
    });
  });

  it("keeps two accounts' usage apart", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await insertJob(tx, { accountId: mine.accountId, userId: mine.userId });
      await insertJob(tx, { accountId: theirs.accountId, userId: theirs.userId });
      await insertJob(tx, { accountId: theirs.accountId, userId: theirs.userId });

      await tx`select roll_up_usage_daily(3)`;

      expect((await usageFor(tx, mine.accountId))[0]?.job_count).toBe(1);
      expect((await usageFor(tx, theirs.accountId))[0]?.job_count).toBe(2);
    });
  });
});
