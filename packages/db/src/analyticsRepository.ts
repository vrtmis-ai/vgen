import type { Sql } from "postgres";

/**
 * What the business is doing, read live.
 *
 * Three views written for the admin panel back in migrations 0001 and 0002 —
 * `v_user_spend`, `v_model_margin`, `v_subscription_revenue` — have been sitting
 * in the schema unread ever since. This is the thing that reads them, and the
 * queries below are their windowed cousins.
 *
 * **Live, not rolled up.** `usage_daily` exists and was designed to be what a
 * dashboard reads, with a comment saying so. Nothing has ever written a row to
 * it. Building the populator, its cron entry and a backfill would be a lot of
 * machinery for a database with almost no rows, and it would make every number
 * up to a day stale. So these scan the real tables. The upgrade path is exactly
 * that table, and the signal to take it is one of these queries getting slow —
 * `jobs (account_id, created_at DESC)` and `credit_ledger (account_id,
 * created_at DESC)` are what hold it up until then.
 *
 * **A day means a Tehran day.** The customers are Iranian and the server is
 * UTC, where midnight falls at 03:30 Tehran — so a UTC day boundary splits one
 * evening's session across two days and makes "today" wrong for everybody
 * reading it. `0018_unlimited_access.sql` established this for the free-tier
 * reset; the same reasoning applies to every number here.
 *
 * **Coins are the unit, money is separate.** Coins bought and coins spent are
 * usage. Revenue is `orders`, in Toman, and provider cost is USD from `jobs`.
 * Margin is revenue minus provider cost — not coins minus cost, which would
 * compare a token to a currency. Revenue reads zero until the payment gateway
 * ships, and that is the true answer rather than a missing one.
 */

export type AnalyticsWindow = "today" | "7d" | "30d" | "all";

/**
 * How many Tehran days back a window starts. `null` is all of history.
 *
 * `7d` is six days back, not seven: the window includes today, so counting a
 * seventh would quietly report eight days of activity under a "7d" label.
 */
const DAYS_BACK: Record<AnalyticsWindow, number | null> = { today: 0, "7d": 6, "30d": 29, all: null };

export interface OverviewTotals {
  coinsSold: number;
  coinsGranted: number;
  coinsSpent: number;
  revenueIrr: number;
  revenueUsd: number;
  providerCostUsd: number;
  /** Revenue minus what the providers charged us. Null while nothing has been sold. */
  grossMarginUsd: number | null;
  jobs: number;
  jobsSucceeded: number;
  jobsFailed: number;
  activeUsers: number;
  newUsers: number;
}

export interface StandingTotals {
  /** Coins customers hold and have not spent. A liability, not revenue. */
  coinsOutstanding: number;
  coinsHeld: number;
  users: number;
  bannedUsers: number;
}

export interface DailyPoint {
  /** A Tehran calendar day, as `YYYY-MM-DD`. */
  day: string;
  jobs: number;
  coinsSpent: number;
  providerCostUsd: number;
  newUsers: number;
}

export interface ModelMarginRow {
  variantId: string | null;
  name: string;
  providerCode: string;
  jobs: number;
  succeeded: number;
  failed: number;
  coinsCharged: number;
  providerCostUsd: number;
  avgSeconds: number | null;
}

export interface ProviderHealthRow {
  providerCode: string;
  providerName: string;
  attempts: number;
  succeeded: number;
  failed: number;
  avgLatencyMs: number | null;
  providerCostUsd: number;
}

export interface UserRow {
  id: string;
  email: string | null;
  handle: string | null;
  displayName: string | null;
  createdAt: number;
  coinsBalance: number;
  coinsHeld: number;
  coinsPurchased: number;
  coinsSpent: number;
  jobs: number;
  providerCostUsd: number;
  lastJobAt: number | null;
  activeBans: number;
}

export type UserSort = "spent" | "purchased" | "balance" | "created";

export interface UserPage {
  users: UserRow[];
  total: number;
}

export interface LedgerEntry {
  id: string;
  entryType: string;
  coins: number;
  balanceAfterCoins: number;
  note: string | null;
  createdAt: number;
}

export interface UserJobRow {
  id: string;
  status: string;
  modelKey: string | null;
  coinsCharged: number;
  providerCostUsd: number | null;
  createdAt: number;
  errorCode: string | null;
}

export interface UserDetail extends UserRow {
  recentJobs: UserJobRow[];
  recentLedger: LedgerEntry[];
}

const n = (value: string | number | null | undefined): number => (value === null || value === undefined ? 0 : Number(value));
const orNull = (value: string | number | null | undefined): number | null => (value === null || value === undefined ? null : Number(value));

export class PostgresAnalyticsRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * The start of a window, as a real timestamptz.
   *
   * `now() at time zone 'Asia/Tehran'` gives Tehran wall-clock time as a naive
   * timestamp; truncating that to a day gives Tehran midnight; converting back
   * gives the instant that midnight actually happened. Doing this in SQL rather
   * than in TypeScript keeps one definition of "a day" for every query here,
   * and keeps it right across a DST change the server does not observe.
   */
  private since(window: AnalyticsWindow) {
    const days = DAYS_BACK[window];
    if (days === null) return this.sql`'-infinity'::timestamptz`;
    return this.sql`(date_trunc('day', now() at time zone 'Asia/Tehran') - make_interval(days => ${days})) at time zone 'Asia/Tehran'`;
  }

  async overview(window: AnalyticsWindow): Promise<OverviewTotals> {
    const from = this.since(window);
    const [row] = await this.sql<Record<string, string | null>[]>`
      select
        -- From credit_lots.source, NOT from a ledger entry_type. grant_credits
        -- writes every arrival as entry_type 'grant' whatever its origin: the
        -- purchase/promo distinction lives on the lot, and that is also what
        -- lifetime_purchased keys off. Reading entry_type here returns zero for
        -- everything, which is the sort of wrong number a dashboard is believed
        -- about.
        (select coalesce(sum(micro_credits_total), 0) / 1e6 from credit_lots
           where source = 'purchase' and created_at >= ${from}) as coins_sold,
        -- Everything else that arrived: signup bonuses, promos, referrals, hand
        -- grants, refunds. Given, not sold — counting these together is how a
        -- promo campaign reads as a good quarter.
        (select coalesce(sum(micro_credits_total), 0) / 1e6 from credit_lots
           where source <> 'purchase' and created_at >= ${from}) as coins_granted,
        (select coalesce(-sum(micro_credits), 0) / 1e6 from credit_ledger
           where entry_type = 'capture' and created_at >= ${from}) as coins_spent,
        (select coalesce(sum(amount), 0) from orders where status = 'paid' and created_at >= ${from}) as revenue_irr,
        (select coalesce(sum(amount_usd), 0) from orders where status = 'paid' and created_at >= ${from}) as revenue_usd,
        (select coalesce(sum(provider_cost_usd), 0) from jobs
           where status = 'succeeded' and created_at >= ${from}) as provider_cost_usd,
        (select count(*) from jobs where created_at >= ${from} and deleted_at is null) as jobs,
        (select count(*) from jobs where status = 'succeeded' and created_at >= ${from} and deleted_at is null) as jobs_succeeded,
        (select count(*) from jobs where status = 'failed' and created_at >= ${from} and deleted_at is null) as jobs_failed,
        -- "Active" means made something, not signed in. A session that browsed
        -- the gallery costs nothing and tells us nothing.
        (select count(distinct created_by) from jobs where created_at >= ${from}) as active_users,
        (select count(*) from users where created_at >= ${from}) as new_users
    `;

    const revenueUsd = n(row!.revenue_usd);
    const providerCostUsd = n(row!.provider_cost_usd);
    return {
      coinsSold: n(row!.coins_sold),
      coinsGranted: n(row!.coins_granted),
      coinsSpent: n(row!.coins_spent),
      revenueIrr: n(row!.revenue_irr),
      revenueUsd,
      providerCostUsd,
      // Null rather than a negative number while nothing has been sold. With no
      // gateway yet, revenue is legitimately zero, and reporting "-$12 margin"
      // would read as a business losing money rather than as one not open.
      grossMarginUsd: revenueUsd === 0 ? null : revenueUsd - providerCostUsd,
      jobs: n(row!.jobs),
      jobsSucceeded: n(row!.jobs_succeeded),
      jobsFailed: n(row!.jobs_failed),
      activeUsers: n(row!.active_users),
      newUsers: n(row!.new_users),
    };
  }

  /** Numbers that are true right now rather than over a period. */
  async standing(): Promise<StandingTotals> {
    const [row] = await this.sql<Record<string, string | null>[]>`
      select
        (select coalesce(sum(micro_credits), 0) / 1e6 from account_balances) as coins_outstanding,
        (select coalesce(sum(held_micro_credits), 0) / 1e6 from account_balances) as coins_held,
        (select count(*) from users where deleted_at is null) as users,
        (select count(distinct user_id) from bans
           where lifted_at is null and (expires_at is null or expires_at > now())) as banned_users
    `;
    return {
      coinsOutstanding: n(row!.coins_outstanding),
      coinsHeld: n(row!.coins_held),
      users: n(row!.users),
      bannedUsers: n(row!.banned_users),
    };
  }

  /**
   * One row per Tehran day in the window, with the empty days filled in.
   *
   * `generate_series` rather than grouping what exists: a day with no jobs is a
   * fact about that day, and a sparkline that silently closed the gap would
   * draw a straight line through an outage.
   */
  async daily(window: AnalyticsWindow): Promise<DailyPoint[]> {
    const days = DAYS_BACK[window] ?? 29;
    const rows = await this.sql<Record<string, string | null>[]>`
      with span as (
        select generate_series(
          (date_trunc('day', now() at time zone 'Asia/Tehran') - make_interval(days => ${days}))::date,
          (now() at time zone 'Asia/Tehran')::date,
          interval '1 day'
        )::date as day
      )
      select
        to_char(span.day, 'YYYY-MM-DD') as day,
        coalesce(j.jobs, 0) as jobs,
        coalesce(l.coins_spent, 0) as coins_spent,
        coalesce(j.provider_cost_usd, 0) as provider_cost_usd,
        coalesce(u.new_users, 0) as new_users
      from span
      left join (
        select (created_at at time zone 'Asia/Tehran')::date as day,
               count(*) as jobs,
               coalesce(sum(provider_cost_usd), 0) as provider_cost_usd
        from jobs where deleted_at is null group by 1
      ) j on j.day = span.day
      left join (
        select (created_at at time zone 'Asia/Tehran')::date as day, -sum(micro_credits) / 1e6 as coins_spent
        from credit_ledger where entry_type = 'capture' group by 1
      ) l on l.day = span.day
      left join (
        select (created_at at time zone 'Asia/Tehran')::date as day, count(*) as new_users
        from users group by 1
      ) u on u.day = span.day
      order by span.day asc
    `;
    return rows.map((row) => ({
      day: String(row.day),
      jobs: n(row.jobs),
      coinsSpent: n(row.coins_spent),
      providerCostUsd: n(row.provider_cost_usd),
      newUsers: n(row.new_users),
    }));
  }

  /**
   * Margin by model — the question "is anything we sell losing us money?"
   *
   * Grouped by the row the customer picked (`jobs.provider_model_id`), not the
   * row that ran it. An admin asks this about a thing in the shop; which
   * provider happened to serve it is the *answer*, which is why the serving
   * provider is a column rather than the grouping.
   */
  async models(window: AnalyticsWindow): Promise<ModelMarginRow[]> {
    const from = this.since(window);
    const rows = await this.sql<Record<string, string | null>[]>`
      select
        model.capabilities -> 'variant' ->> 'id' as variant_id,
        model.name,
        provider.code as provider_code,
        count(*) as jobs,
        count(*) filter (where job.status = 'succeeded') as succeeded,
        count(*) filter (where job.status = 'failed') as failed,
        coalesce(sum(job.micro_credits_charged), 0) / 1e6 as coins_charged,
        coalesce(sum(job.provider_cost_usd), 0) as provider_cost_usd,
        avg(extract(epoch from (job.completed_at - job.started_at))) filter (where job.status = 'succeeded') as avg_seconds
      from jobs job
      join provider_models model on model.id = job.provider_model_id
      join providers provider on provider.id = model.provider_id
      where job.created_at >= ${from} and job.deleted_at is null
      group by 1, 2, 3
      order by coalesce(sum(job.provider_cost_usd), 0) desc, count(*) desc
    `;
    return rows.map((row) => ({
      variantId: row.variant_id ?? null,
      name: String(row.name),
      providerCode: String(row.provider_code),
      jobs: n(row.jobs),
      succeeded: n(row.succeeded),
      failed: n(row.failed),
      coinsCharged: n(row.coins_charged),
      providerCostUsd: n(row.provider_cost_usd),
      avgSeconds: orNull(row.avg_seconds),
    }));
  }

  /**
   * Per provider, from `job_attempts` rather than `jobs`.
   *
   * One job can be several attempts across more than one provider — that is
   * what the table is for — so counting jobs here would credit a retry's
   * success to whoever failed first, and hide exactly the flakiness this
   * section exists to show.
   */
  async providers(window: AnalyticsWindow): Promise<ProviderHealthRow[]> {
    const from = this.since(window);
    const rows = await this.sql<Record<string, string | null>[]>`
      select
        provider.code as provider_code,
        provider.name as provider_name,
        count(attempt.*) as attempts,
        count(attempt.*) filter (where attempt.status = 'succeeded') as succeeded,
        count(attempt.*) filter (where attempt.status in ('failed', 'timeout')) as failed,
        avg(attempt.latency_ms) as avg_latency_ms,
        coalesce(sum(job.provider_cost_usd) filter (where job.status = 'succeeded'), 0) as provider_cost_usd
      from providers provider
      left join job_attempts attempt on attempt.provider_id = provider.id and attempt.started_at >= ${from}
      left join jobs job on job.id = attempt.job_id
      group by 1, 2
      order by count(attempt.*) desc, provider.code
    `;
    return rows.map((row) => ({
      providerCode: String(row.provider_code),
      providerName: String(row.provider_name),
      attempts: n(row.attempts),
      succeeded: n(row.succeeded),
      failed: n(row.failed),
      avgLatencyMs: orNull(row.avg_latency_ms),
      providerCostUsd: n(row.provider_cost_usd),
    }));
  }

  /**
   * The customer list.
   *
   * Sorted only on columns `account_balances` already caches. Sorting on a
   * lateral aggregate would make Postgres compute every user's job history
   * before it could take a page of twenty — fine at today's size and quietly
   * catastrophic later, and this is the one query certain to be pointed at a
   * large table eventually.
   *
   * Everyone appears, including people who signed up and never generated:
   * "this person says they paid and I cannot find them" is precisely the case
   * this list exists for.
   */
  async users(options: { search?: string | undefined; sort: UserSort; limit: number; offset: number }): Promise<UserPage> {
    const term = options.search?.trim() ? `%${options.search.trim()}%` : null;
    const order =
      options.sort === "purchased"
        ? this.sql`coalesce(balance.lifetime_purchased, 0) desc`
        : options.sort === "balance"
          ? this.sql`coalesce(balance.micro_credits, 0) desc`
          : options.sort === "created"
            ? this.sql`account_user.created_at desc`
            : this.sql`coalesce(balance.lifetime_spent, 0) desc`;

    const rows = await this.sql<Record<string, string | Date | null>[]>`
      select
        account_user.id, account_user.email, account_user.handle, account_user.display_name, account_user.created_at,
        coalesce(balance.micro_credits, 0) / 1e6      as coins_balance,
        coalesce(balance.held_micro_credits, 0) / 1e6 as coins_held,
        coalesce(balance.lifetime_purchased, 0) / 1e6 as coins_purchased,
        coalesce(balance.lifetime_spent, 0) / 1e6     as coins_spent,
        coalesce(activity.jobs, 0)                    as jobs,
        coalesce(activity.provider_cost_usd, 0)       as provider_cost_usd,
        activity.last_job_at,
        (select count(*) from bans
          where bans.user_id = account_user.id and bans.lifted_at is null
            and (bans.expires_at is null or bans.expires_at > now())) as active_bans,
        count(*) over () as total
      from users account_user
      join accounts account on account.id = account_user.personal_account_id
      left join account_balances balance on balance.account_id = account.id
      left join lateral (
        select count(*) as jobs, sum(provider_cost_usd) as provider_cost_usd, max(created_at) as last_job_at
        from jobs where jobs.account_id = account.id and jobs.deleted_at is null
      ) activity on true
      where account_user.deleted_at is null
        and (
          ${term}::text is null
          or account_user.email ilike ${term}
          or account_user.handle ilike ${term}
          or account_user.display_name ilike ${term}
        )
      order by ${order}
      limit ${options.limit} offset ${options.offset}
    `;

    return {
      users: rows.map(toUserRow),
      // `count(*) over ()` rather than a second query: the window function is
      // computed from the same scan, so the total cannot disagree with the page.
      total: rows.length > 0 ? n(rows[0]!.total as string) : 0,
    };
  }

  async user(userId: string): Promise<UserDetail | null> {
    const page = await this.sql<Record<string, string | Date | null>[]>`
      select
        account_user.id, account_user.email, account_user.handle, account_user.display_name, account_user.created_at,
        coalesce(balance.micro_credits, 0) / 1e6      as coins_balance,
        coalesce(balance.held_micro_credits, 0) / 1e6 as coins_held,
        coalesce(balance.lifetime_purchased, 0) / 1e6 as coins_purchased,
        coalesce(balance.lifetime_spent, 0) / 1e6     as coins_spent,
        coalesce(activity.jobs, 0)                    as jobs,
        coalesce(activity.provider_cost_usd, 0)       as provider_cost_usd,
        activity.last_job_at,
        (select count(*) from bans
          where bans.user_id = account_user.id and bans.lifted_at is null
            and (bans.expires_at is null or bans.expires_at > now())) as active_bans
      from users account_user
      join accounts account on account.id = account_user.personal_account_id
      left join account_balances balance on balance.account_id = account.id
      left join lateral (
        select count(*) as jobs, sum(provider_cost_usd) as provider_cost_usd, max(created_at) as last_job_at
        from jobs where jobs.account_id = account.id and jobs.deleted_at is null
      ) activity on true
      where account_user.id = ${userId} and account_user.deleted_at is null
    `;
    const row = page[0];
    if (!row) return null;

    const [jobs, ledger] = await Promise.all([
      this.sql<Record<string, string | Date | null>[]>`
        select job.id, job.status, model.capabilities -> 'variant' ->> 'id' as model_key,
               job.micro_credits_charged, job.provider_cost_usd, job.created_at, job.error_code
        from jobs job
        left join provider_models model on model.id = job.provider_model_id
        where job.created_by = ${userId} and job.deleted_at is null
        order by job.created_at desc
        limit 20
      `,
      this.sql<Record<string, string | Date | null>[]>`
        select entry.id, entry.entry_type, entry.micro_credits, entry.balance_after, entry.note, entry.created_at
        from credit_ledger entry
        join accounts account on account.id = entry.account_id
        join users owner on owner.personal_account_id = account.id
        where owner.id = ${userId}
        order by entry.created_at desc
        limit 20
      `,
    ]);

    return {
      ...toUserRow(row),
      recentJobs: jobs.map((job) => ({
        id: String(job.id),
        status: String(job.status),
        modelKey: job.model_key === null ? null : String(job.model_key),
        coinsCharged: n(job.micro_credits_charged as string) / 1e6,
        providerCostUsd: orNull(job.provider_cost_usd as string),
        createdAt: (job.created_at as Date).getTime(),
        errorCode: job.error_code === null ? null : String(job.error_code),
      })),
      recentLedger: ledger.map((entry) => ({
        id: String(entry.id),
        entryType: String(entry.entry_type),
        coins: n(entry.micro_credits as string) / 1e6,
        balanceAfterCoins: n(entry.balance_after as string) / 1e6,
        note: entry.note === null ? null : String(entry.note),
        createdAt: (entry.created_at as Date).getTime(),
      })),
    };
  }

  /**
   * Give or take coins by hand.
   *
   * Straight through to `adjust_credits`, which is where the correctness lives:
   * FIFO lot consumption, an append-only ledger row whose `balance_after`
   * matches, and the balance cache moved with it. Doing any of that here would
   * be a second implementation of the money path.
   */
  async adjustCredits(input: { userId: string; coins: number; note: string; actorUserId: string }): Promise<void> {
    const [account] = await this.sql<{ id: string }[]>`
      select account.id from accounts account
      join users owner on owner.personal_account_id = account.id
      where owner.id = ${input.userId}
    `;
    if (!account) throw new Error("no such user");
    await this.sql`
      select adjust_credits(${account.id}, ${Math.round(input.coins * 1e6)}, ${input.note}, ${input.actorUserId})
    `;
  }

  /**
   * End every customer session this user has.
   *
   * Revoked rather than deleted, for the same reason a lifted ban keeps its
   * row: "were they signed out, and when" survives. It does not touch
   * `admin_sessions` — a customer and a staff session are different things and
   * this route is about the customer.
   */
  async revokeSessions(userId: string): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`
      update sessions set revoked_at = now()
      where user_id = ${userId} and revoked_at is null
      returning id
    `;
    return rows.length;
  }
}

function toUserRow(row: Record<string, string | Date | null>): UserRow {
  return {
    id: String(row.id),
    email: row.email === null ? null : String(row.email),
    handle: row.handle === null ? null : String(row.handle),
    displayName: row.display_name === null ? null : String(row.display_name),
    createdAt: (row.created_at as Date).getTime(),
    coinsBalance: n(row.coins_balance as string),
    coinsHeld: n(row.coins_held as string),
    coinsPurchased: n(row.coins_purchased as string),
    coinsSpent: n(row.coins_spent as string),
    jobs: n(row.jobs as string),
    providerCostUsd: n(row.provider_cost_usd as string),
    lastJobAt: row.last_job_at === null ? null : (row.last_job_at as Date).getTime(),
    activeBans: n(row.active_bans as string),
  };
}
