import postgres, { type Sql } from "postgres";
import { TEST_DATABASE_URL, COIN } from "./integrationHarness";

/**
 * A second integration harness, for the tests that have to actually race.
 *
 * `integrationHarness.ts` opens `postgres(url, { max: 1 })` and wraps every
 * test in a transaction it always rolls back. That is the right default — it is
 * stricter than dropping a schema, and tests share one database — but it makes
 * a whole class of bug structurally untestable:
 *
 * - one connection means a second transaction cannot even open, so two
 *   submissions can only ever run one after the other; and
 * - nothing a test writes is ever committed, so a second connection could not
 *   see the account, the plan or the quote the race is supposed to be about.
 *
 * Concurrency bugs live exactly in the gap those two properties close. Under
 * READ COMMITTED, the thing that goes wrong is that transaction B cannot see
 * the row transaction A has inserted but not yet committed — which is invisible
 * to a harness where B does not exist.
 *
 * So this one opens a real pool and commits. The cost is that it has to clean
 * up after itself, and the cost of *that* is the reason for `sharedAccounts`
 * below.
 */
export function connectPool(max = 4): Sql {
  return postgres(TEST_DATABASE_URL, { max, idle_timeout: 5 });
}

export interface RaceAccount {
  userId: string;
  accountId: string;
  email: string;
}

/**
 * Accounts reused across runs, addressed by a fixed email.
 *
 * A committed test cannot simply delete the account it made. `credit_ledger`
 * is append-only — migration 0001 puts `DO INSTEAD NOTHING` rules on UPDATE and
 * DELETE — and `credit_ledger_account_id_fkey` is NO ACTION, so once an account
 * has been funded it is permanently undeletable, by design. Creating a fresh
 * one per test would therefore leave one behind every time, and this suite is
 * meant to be run with `--repeat 20`: two hundred orphan accounts a session,
 * each with a ledger nothing can remove.
 *
 * Reusing a fixed handful and resetting their *mutable* state instead keeps the
 * litter at a constant few rows no matter how often the suite runs. Credit lots
 * and ledger entries still accumulate, which is fine — the ledger is supposed
 * to accumulate, and every assertion here is a delta rather than an absolute
 * for the same reason the analytics tests are.
 */
export async function sharedAccount(sql: Sql, slot: string): Promise<RaceAccount> {
  const email = `race-harness-${slot}@deev.test`;
  const [found] = await sql<{ id: string; personal_account_id: string }[]>`
    select id, personal_account_id from users where email = ${email} and personal_account_id is not null
  `;
  if (found) return { userId: found.id, accountId: found.personal_account_id, email };

  const [account] = await sql<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
  const [user] = await sql<{ id: string }[]>`
    insert into users (email, personal_account_id) values (${email}, ${account!.id}) returning id
  `;
  return { userId: user!.id, accountId: account!.id, email };
}

/**
 * Put an account back to "funded, subscribed, nothing in flight".
 *
 * Deleted in dependency order, and only the things a submission creates: this
 * must never touch a row belonging to whoever else is using this database.
 * `credit_ledger` is deliberately not in the list — it cannot be deleted and
 * should not be.
 */
export async function resetAccount(sql: Sql, account: RaceAccount, options: { concurrency?: number; coins?: number } = {}) {
  const { accountId } = account;

  await sql`delete from outbox where payload ->> 'accountId' = ${accountId}`;
  await sql`
    delete from credit_hold_lots
    where hold_id in (select id from credit_holds where account_id = ${accountId})
  `;
  await sql`delete from credit_holds where account_id = ${accountId}`;
  // job_attempts, job_inputs, image_jobs and video_jobs all cascade from jobs.
  await sql`delete from assets where job_id in (select id from jobs where account_id = ${accountId})`;
  await sql`delete from jobs where account_id = ${accountId}`;
  await sql`delete from quotes where account_id = ${accountId}`;
  await sql`delete from subscriptions where account_id = ${accountId}`;

  const concurrency = options.concurrency ?? 8;
  const suffix = Math.random().toString(36).slice(2, 10);
  const [plan] = await sql<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, max_concurrent_jobs)
    values (${`race-plan-${suffix}`}, 'Race Test Plan', 3, 1000000, 10, ${concurrency})
    returning id
  `;
  await sql`
    insert into subscriptions (account_id, plan_id, status, ends_at)
    values (${accountId}, ${plan!.id}, 'active', now() + interval '30 days')
  `;

  // Topped up rather than granted every time: a lot per test run would make the
  // lot table grow without bound, and the balance is what the test needs, not a
  // particular number of lots.
  const target = (options.coins ?? 500) * COIN;
  const [balance] = await sql<{ available: string }[]>`
    select coalesce(sum(micro_credits_remaining), 0)::text as available
    from credit_lots
    where account_id = ${accountId} and micro_credits_remaining > 0 and (expires_at is null or expires_at > now())
  `;
  const short = target - Number(balance?.available ?? 0);
  if (short > 0) await sql`select grant_credits(${accountId}, 'purchase', ${short})`;
}

/** Spendable coins, in micro-credits, read from the lots rather than the cache. */
export async function available(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ available: string }[]>`
    select coalesce(sum(micro_credits_remaining), 0)::text as available
    from credit_lots
    where account_id = ${accountId} and micro_credits_remaining > 0 and (expires_at is null or expires_at > now())
  `;
  return Number(row?.available ?? 0);
}

/** Jobs an account has in flight, counted the way the limit counts them. */
export async function inFlight(sql: Sql, accountId: string): Promise<number> {
  const [row] = await sql<{ count: string }[]>`
    select count(*)::text as count from jobs
    where account_id = ${accountId} and status in ('queued', 'running') and deleted_at is null
  `;
  return Number(row?.count ?? 0);
}

/**
 * Two bodies started together and both awaited, whatever happens to either.
 *
 * `Promise.all` rejects on the first failure and abandons the other, which in a
 * database test means a transaction left open on a pooled connection and the
 * next test blocking on a lock it cannot see. Both results come back, errors
 * included, and the assertions decide what they should have been.
 */
export function bothOf<A, B>(a: () => Promise<A>, b: () => Promise<B>): Promise<[Settled<A>, Settled<B>]> {
  return Promise.all([settled(a()), settled(b())]);
}

export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

const settled = async <T>(promise: Promise<T>): Promise<Settled<T>> => {
  try {
    return { ok: true, value: await promise };
  } catch (error) {
    return { ok: false, error };
  }
};

/** The outcomes of a pair of submissions, sorted so an assertion can be written once. */
export const outcomesOf = (results: Settled<{ outcome: string }>[]): string[] =>
  results.map((result) => (result.ok ? result.value.outcome : `threw:${String(result.error)}`)).sort();
