import type { Sql, TransactionSql } from "postgres";

/**
 * Who may run what, and what it costs them — the half of pricing that is not a
 * number.
 *
 * Two questions live here because they are asked at the same instant and both
 * answer "may this account run this model, and on what terms":
 *
 *   the tier gate — does the account's plan reach this model at all
 *   the unlimited grant — is this one free for them, and have they had their
 *     share today
 *
 * Both were previously decided in the browser, which is to say not decided:
 * `src/lib/access.tsx` draws a padlock, and curl has never seen a padlock.
 */

/** Plan tiers, matching the CHECK on plans.tier and a family's minTier. */
export type Tier = 1 | 2 | 3;

export interface UnlimitedGrant {
  id: string;
  /** The provider_models row that actually runs it — a different provider. */
  servingModelId: string;
  /** Free generations per account per day. Null means genuinely uncapped. */
  dailyCap: number | null;
  /**
   * `control key -> the values this grant covers`. Null means every setting.
   *
   * The subscription does not necessarily serve everything the metered provider
   * does — it runs Nano Banana to 2K and not at 4K — so a grant can exist and
   * still not apply to the generation being asked for. A key absent from the
   * object is unconstrained, so adding a control to a variant never silently
   * withdraws an existing grant.
   */
  covers: Record<string, string[]> | null;
}

export interface Concurrency {
  /** Generations this account may have in flight at once. */
  limit: number;
  /** How many it has in flight right now. */
  running: number;
}

export interface GrantAvailability {
  grant: UnlimitedGrant;
  /** How many of today's allowance are gone. */
  used: number;
  /** Null when the grant is uncapped. */
  remaining: number | null;
}

/**
 * The day boundary is Tehran's, not UTC's.
 *
 * The customers are Iranian and the server is UTC. A UTC reset lands at 03:30
 * Tehran, which hands someone a second full allowance in the middle of one
 * evening and none the next — so the date is computed in the database, in
 * Tehran time, and never in the application where a container's clock or a
 * differently-configured replica could disagree with it.
 */
const TEHRAN_TODAY = `(now() at time zone 'Asia/Tehran')::date`;

/**
 * Simultaneous generations for an account with no subscription.
 *
 * Two, not one. The four entry plans are coin packs now — coins and no
 * membership — so the customers who have paid the least have no subscription
 * row to read a limit off, and two at a time is the owner's rule for everyone
 * below the three subscription plans. A gift account gets the same, bounded by
 * its twenty coins rather than by this.
 */
export const BASE_CONCURRENT_JOBS = 2;

export class PostgresEntitlementsRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * The tier an account holds right now.
   *
   * `max` across live subscriptions, matching what `v_account_entitlements`
   * does for every other perk: buying a second plan before the first expires
   * gives you the best of both, never the most recent.
   *
   * No subscription is tier 1 rather than tier 0, the same fallback
   * `plansRepository.tierFor` makes — a new account holds a signup gift and
   * tier 1 is what makes that gift spendable.
   *
   * This no longer decides what an account may RUN. Models are not locked to
   * plans any more — the only gate on a generation is whether the wallet can
   * pay for it — so a family's `minTier` is catalogue trivia and the quote
   * path stopped comparing against it. What a tier still buys is the unlimited
   * pipe, through `unlimitedTierForAccount`, which puts a clock on it.
   */
  async tierForAccount(accountId: string): Promise<Tier> {
    const [row] = await this.sql<{ tier: number }[]>`
      select coalesce(max(plan.tier), 1) as tier
      from subscriptions sub
      join plans plan on plan.id = sub.plan_id
      where sub.account_id = ${accountId}
        and sub.status = 'active'
        and sub.ends_at > now()
    `;
    return (row?.tier as Tier | undefined) ?? 1;
  }

  /**
   * The tier the unlimited pipe sees — the plan's own, but only while its
   * window is open.
   *
   * Pro carries unlimited for seven days of its term, Studio and Creator for a
   * month, and a pack never carries it at all. Expressed as a tier rather than
   * as a separate "is the window open" flag so nothing downstream has to learn
   * a second concept: `findGrant` already asks whether a tier reaches an
   * entitlement, and a closed window simply stops reaching one.
   *
   * Measured from `starts_at`, so buying again opens a new window. That is the
   * point of selling the perk by the term rather than by the account.
   */
  async unlimitedTierForAccount(accountId: string): Promise<Tier> {
    const [row] = await this.sql<{ tier: number }[]>`
      select coalesce(max(plan.tier), 1) as tier
      from subscriptions sub
      join plans plan on plan.id = sub.plan_id
      where sub.account_id = ${accountId}
        and sub.status = 'active'
        and sub.ends_at > now()
        and plan.unlimited_days > 0
        and now() < sub.starts_at + (plan.unlimited_days * interval '1 day')
    `;
    return (row?.tier as Tier | undefined) ?? 1;
  }

  /**
   * How many generations this account may run at once, and how many it is
   * running.
   *
   * The limit follows `v_account_entitlements` exactly: the best of every live
   * plan, raised — never lowered — by an `account_limits` override, with a
   * floor of `BASE_CONCURRENT_JOBS`. An account with no subscription gets that
   * floor — which now includes everyone holding a coin pack, because a pack
   * grants coins and no membership to read a limit off.
   *
   * Counted from `jobs` rather than tracked in a counter column, because a
   * counter is a second source of truth that drifts the first time a worker
   * dies mid-job. `queued` and `running` are both in flight; a `draft` has not
   * been submitted and the terminal states are done.
   *
   * Note this is a limit on what one account may have in flight, which is not
   * the same as what the providers can serve — the useapi pool is about six
   * concurrent generations for everybody. A top plan submitting eight is
   * expected and fine: the queue is what absorbs the difference.
   */
  async concurrencyFor(accountId: string): Promise<Concurrency> {
    return this.concurrencyForTx(this.sql, accountId);
  }

  /**
   * The same count, read inside a caller's transaction.
   *
   * Submission needs it under the same lock as the job insert. Read on its own
   * connection it would be a number from before the row that is about to exist,
   * which is how an account ends up with one more generation running than its
   * plan allows.
   */
  async concurrencyForTx(tx: Sql | TransactionSql, accountId: string): Promise<Concurrency> {
    const [row] = await (tx as Sql)<{ limit: number; running: number }[]>`
      select
        greatest(
          -- The base only stands in for a plan that is not there. A plan that
          -- states a limit keeps it, including one lower than the base: the
          -- floor is for accounts with nothing to read, not a veto on the
          -- ladder.
          coalesce((
            select max(plan.max_concurrent_jobs)
            from subscriptions sub
            join plans plan on plan.id = sub.plan_id
            where sub.account_id = ${accountId} and sub.status = 'active' and sub.ends_at > now()
          ), ${BASE_CONCURRENT_JOBS}),
          coalesce((select max_concurrent_jobs from account_limits where account_id = ${accountId}), 0),
          1
        )::int as limit,
        (
          select count(*) from jobs
          where account_id = ${accountId}
            and status in ('queued', 'running')
            and deleted_at is null
        )::int as running
    `;
    return { limit: row?.limit ?? BASE_CONCURRENT_JOBS, running: row?.running ?? 0 };
  }

  /**
   * The active grant covering this model and feature for an account at this
   * tier, or null if there is none it reaches.
   *
   * A grant whose `feature_id` is null covers every feature the model serves;
   * one that names a feature covers only that. So "unlimited Nano Banana"
   * granted for image_generate does not quietly also make image_edit free.
   */
  async findGrant(catalogModelId: string, featureId: string, tier: Tier): Promise<UnlimitedGrant | null> {
    const [row] = await this.sql<
      { id: string; serving_model_id: string; daily_cap: number | null; covers: Record<string, string[]> | null }[]
    >`
      select ent.id, ent.serving_model_id, ent.daily_cap, ent.covers
      from unlimited_entitlements ent
      join provider_models serving on serving.id = ent.serving_model_id
      join providers provider on provider.id = serving.provider_id
      where ent.catalog_model_id = ${catalogModelId}
        and ent.is_active
        and ent.min_tier <= ${tier}
        and (ent.feature_id is null or ent.feature_id = ${featureId})
        -- A grant pointing at a deactivated model or a provider we have turned
        -- off is not a grant. Without this the quote would come back free and
        -- the job would then have nowhere to run.
        and serving.is_active
        and provider.is_active
      limit 1
    `;
    return row ? { id: row.id, servingModelId: row.serving_model_id, dailyCap: row.daily_cap, covers: row.covers } : null;
  }

  /**
   * The grant plus what is left of today's allowance.
   *
   * Read-only: this is what the quote path asks so it can decide between a
   * free price and the paid one. Nothing is consumed until a job is actually
   * submitted, because a quote a customer never acts on must not cost them
   * part of their day.
   */
  async availability(catalogModelId: string, featureId: string, accountId: string, tier: Tier): Promise<GrantAvailability | null> {
    const grant = await this.findGrant(catalogModelId, featureId, tier);
    if (!grant) return null;

    const [row] = await this.sql<{ used: number }[]>`
      select used from unlimited_usage
      where entitlement_id = ${grant.id}
        and account_id = ${accountId}
        and usage_date = ${this.sql.unsafe(TEHRAN_TODAY)}
    `;
    const used = row?.used ?? 0;
    return { grant, used, remaining: grant.dailyCap === null ? null : Math.max(0, grant.dailyCap - used) };
  }

  /**
   * Take one from today's allowance, or refuse.
   *
   * The `where` on the update is the whole mechanism: under READ COMMITTED
   * Postgres re-evaluates it after taking the row lock, so two concurrent
   * submissions at used = 49 cannot both see 49 and both write 50. A
   * suppressed update returns no row, which is the refusal — the same shape
   * the content-comparing seeders rely on, used here as a mutex rather than as
   * an optimisation.
   *
   * Call this inside the transaction that creates the job. If the job insert
   * fails the claim rolls back with it, so a generation that never existed
   * cannot cost someone part of their day.
   *
   * The cap is read from the grant row inside the same statement rather than
   * passed in. A caller-supplied ceiling is a ceiling a caller can get wrong,
   * and the one thing standing between fifty free generations a day and
   * unlimited ones should not travel through application code to get here.
   */
  async claim(tx: Sql | TransactionSql, entitlementId: string, accountId: string): Promise<number | null> {
    const [row] = await (tx as Sql)<{ used: number }[]>`
      insert into unlimited_usage (entitlement_id, account_id, usage_date, used)
      select ent.id, ${accountId}, ${(tx as Sql).unsafe(TEHRAN_TODAY)}, 1
      from unlimited_entitlements ent
      where ent.id = ${entitlementId}
      on conflict (entitlement_id, account_id, usage_date) do update
        set used = unlimited_usage.used + 1
        where (select ent.daily_cap from unlimited_entitlements ent where ent.id = ${entitlementId}) is null
           or unlimited_usage.used < (select ent.daily_cap from unlimited_entitlements ent where ent.id = ${entitlementId})
      returning used
    `;
    return row?.used ?? null;
  }

  /**
   * Give the allowance back when the generation never happened.
   *
   * A provider failure is not a use. `greatest(used - 1, 0)` rather than a
   * plain decrement because releasing twice — a retry that both fails and is
   * cleaned up — must not push the counter below zero and hand out a free day.
   */
  async release(tx: Sql | TransactionSql, grantId: string, accountId: string): Promise<void> {
    await (tx as Sql)`
      update unlimited_usage
      set used = greatest(used - 1, 0)
      where entitlement_id = ${grantId}
        and account_id = ${accountId}
        and usage_date = ${(tx as Sql).unsafe(TEHRAN_TODAY)}
    `;
  }
}
