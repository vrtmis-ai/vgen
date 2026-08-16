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
   * How many generations this account may run at once, and how many it is
   * running.
   *
   * The limit follows `v_account_entitlements` exactly: the best of every live
   * plan, raised — never lowered — by an `account_limits` override, with a
   * floor of one. An account with no plan gets that floor, which makes the
   * signup gift a trial rather than a batch pipeline.
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
    const [row] = await this.sql<{ limit: number; running: number }[]>`
      select
        greatest(
          coalesce((
            select max(plan.max_concurrent_jobs)
            from subscriptions sub
            join plans plan on plan.id = sub.plan_id
            where sub.account_id = ${accountId} and sub.status = 'active' and sub.ends_at > now()
          ), 0),
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
    return { limit: row?.limit ?? 1, running: row?.running ?? 0 };
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
    const [row] = await this.sql<{ id: string; serving_model_id: string; daily_cap: number | null }[]>`
      select ent.id, ent.serving_model_id, ent.daily_cap
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
    return row ? { id: row.id, servingModelId: row.serving_model_id, dailyCap: row.daily_cap } : null;
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
   */
  async claim(tx: TransactionSql, grant: UnlimitedGrant, accountId: string): Promise<number | null> {
    const [row] = await tx<{ used: number }[]>`
      insert into unlimited_usage (entitlement_id, account_id, usage_date, used)
      values (${grant.id}, ${accountId}, ${tx.unsafe(TEHRAN_TODAY)}, 1)
      on conflict (entitlement_id, account_id, usage_date) do update
        set used = unlimited_usage.used + 1
        where ${grant.dailyCap}::int is null or unlimited_usage.used < ${grant.dailyCap}
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
  async release(tx: TransactionSql, grantId: string, accountId: string): Promise<void> {
    await tx`
      update unlimited_usage
      set used = greatest(used - 1, 0)
      where entitlement_id = ${grantId}
        and account_id = ${accountId}
        and usage_date = ${tx.unsafe(TEHRAN_TODAY)}
    `;
  }
}
