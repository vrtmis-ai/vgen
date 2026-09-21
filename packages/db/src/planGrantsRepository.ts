import type { Sql } from "postgres";
import { atomically } from "./transaction";

/**
 * Putting an account on a plan without it having paid.
 *
 * The case that asked for it is staff: a main admin turning a plan on for a
 * lower-level admin so they can use the product they are running. The shape is
 * general because the operation is — a comped account, a support gesture, and
 * eventually the payment webhook are all "this account is now on this plan
 * until this date", and a second implementation of that would be a second set
 * of rules about credits that could disagree with the first.
 *
 * The part worth being precise about is the limit.
 *
 * A grant is NOT unlimited access. `unlimited_entitlements` already exists for
 * that, it is per-model, and it is a different decision. What this does is give
 * the account exactly what a paying customer on that plan gets for one term:
 *
 *   · a `subscriptions` row, which is what `plans.tier` is read through, so
 *     the tier gate opens on the models the plan covers;
 *   · a `credit_lots` row of `micro_credits_per_term`, expiring when the term
 *     does, which is the monthly ceiling and enforces itself — the wallet sums
 *     lots and the hold path refuses to overdraw them;
 *   · a `credit_ledger` entry, because every movement of credit in this system
 *     is on the ledger and an off-ledger grant would break the reconciliation
 *     that proves nothing is lost.
 *
 * So "activate a plan for an admin, and it still has the monthly limit" is not
 * a rule this code has to remember to apply. It is what granting one term of a
 * plan means: the credits run out, and the next term is another grant.
 *
 * Unless the plan is a PACK. The four entry plans are packs now — `term_days`
 * of 0 — and a pack is the opposite promise: the coins never expire, so the
 * lot is written with no `expires_at` at all and the subscription that records
 * the purchase never ends. Both follow from the one column, so there is no
 * second kind of grant to keep in step, and a pack cannot be blocked by an
 * active plan the way a second subscription is — buying coins twice is
 * ordinary, holding two subscriptions is not.
 */

export interface PlanGrant {
  subscriptionId: string;
  planCode: string;
  planName: string;
  tier: number;
  /** One term's worth, in coins. What the account may spend before it ends. */
  coins: number;
  startsAt: number;
  /** Null on a pack, which never ends. */
  endsAt: number | null;
  status: string;
}

export type GrantOutcome =
  | { outcome: "granted"; grant: PlanGrant }
  | { outcome: "already_active"; grant: PlanGrant }
  | { outcome: "unknown_plan" }
  | { outcome: "unknown_account" };

interface PlanRow {
  id: string;
  code: string;
  name: string;
  tier: number;
  micro_credits_per_term: string;
  term_days: number;
}

interface SubscriptionRow {
  id: string;
  plan_code: string;
  plan_name: string;
  tier: number;
  micro_credits_granted: string;
  starts_at: Date;
  ends_at: Date;
  status: string;
}

const toGrant = (row: SubscriptionRow, coins: number): PlanGrant => ({
  subscriptionId: row.id,
  planCode: row.plan_code,
  planName: row.plan_name,
  tier: row.tier,
  coins,
  startsAt: row.starts_at.getTime(),
  // A pack's row ends at 'infinity', which `getTime()` reads as Infinity — a
  // number JSON turns into null on the way out and a date formatter renders as
  // "Invalid Date". Said once, here, so every reader gets the same null.
  endsAt: Number.isFinite(row.ends_at.getTime()) ? row.ends_at.getTime() : null,
  status: row.status,
});

/** A pack: coins that never expire, sold as a plan but not a membership. */
const isPack = (termDays: number): boolean => termDays === 0;

/** micro-credits to coins, the same hundredth this system bills in. */
const coinsOf = (microCredits: string | number): number => Number(microCredits) / 100;

export class PostgresPlanGrantsRepository {
  constructor(private readonly sql: Sql) {}

  /** What is live on an account right now, if anything. */
  async activeFor(accountId: string): Promise<PlanGrant | null> {
    const [row] = await this.sql<SubscriptionRow[]>`
      select sub.id, plan.code as plan_code, plan.name as plan_name, plan.tier,
             sub.micro_credits_granted, sub.starts_at, sub.ends_at, sub.status
      from subscriptions sub
      join plans plan on plan.id = sub.plan_id
      where sub.account_id = ${accountId} and sub.status = 'active' and sub.ends_at > now()
      order by plan.tier desc
      limit 1
    `;
    return row ? toGrant(row, coinsOf(row.micro_credits_granted)) : null;
  }

  /**
   * Turn a plan on for one term.
   *
   * Refuses rather than stacking when something is already live. Two active
   * subscriptions on one account would make `max(plan.tier)` the answer to
   * "what plan is this" — true, and unhelpful when somebody later asks why the
   * account has two terms' credits. Deactivate, then grant.
   */
  async grant(input: { accountId: string; planCode: string; grantedBy: string; note?: string | undefined }): Promise<GrantOutcome> {
    return atomically(this.sql)(async (tx) => {
      const [account] = await tx<{ id: string }[]>`select id from accounts where id = ${input.accountId}`;
      if (!account) return { outcome: "unknown_account" as const };

      const [plan] = await tx<PlanRow[]>`
        select id, code, name, tier, micro_credits_per_term, term_days
        from plans where code = ${input.planCode} and is_active
      `;
      if (!plan) return { outcome: "unknown_plan" as const };

      /* Only a term plan can be "already active". Two live subscriptions make
         `max(plan.tier)` the answer to "what plan is this" — true, and no help
         to whoever later asks why the account holds two terms of credit. A
         pack is not a membership, so buying one while a plan runs, or buying
         several, is just buying coins. */
      const [live] = isPack(plan.term_days)
        ? []
        : await tx<SubscriptionRow[]>`
            select sub.id, p.code as plan_code, p.name as plan_name, p.tier,
                   sub.micro_credits_granted, sub.starts_at, sub.ends_at, sub.status
            from subscriptions sub
            join plans p on p.id = sub.plan_id
            where sub.account_id = ${input.accountId} and sub.status = 'active' and sub.ends_at > now()
              and p.term_days > 0
            limit 1
          `;
      if (live) return { outcome: "already_active" as const, grant: toGrant(live, coinsOf(live.micro_credits_granted)) };

      const microCredits = plan.micro_credits_per_term;

      /* On a term plan the lot expires when the term does, and that expiry IS
         the monthly limit — not a counter somebody has to remember to check:
         the wallet sums lots with credit remaining and the hold path refuses to
         overdraw, so an account that spends its term's credits in a week cannot
         start another generation until the next grant.

         On a pack there is no expiry and no limit. `expires_at` is null, which
         `walletRepository` already reads as "never" — the column was nullable
         from the first migration precisely for a grant like this one. */
      const expiry = isPack(plan.term_days) ? null : `${plan.term_days} days`;
      const [lot] = await tx<{ id: string }[]>`
        insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
        values (${input.accountId}, 'admin_grant', ${microCredits}, ${microCredits},
                ${expiry === null ? null : tx`now() + ${expiry}::interval`})
        returning id
      `;

      const [subscription] = await tx<SubscriptionRow[]>`
        insert into subscriptions (account_id, plan_id, plan_snapshot, micro_credits_granted, lot_id, status, ends_at)
        values (
          ${input.accountId}, ${plan.id},
          -- Exactly as granted. Changing the plan tomorrow must not
          -- retroactively change what this account was given, which is the
          -- same reason a purchase snapshots it.
          ${tx.json({ code: plan.code, name: plan.name, tier: plan.tier, microCreditsPerTerm: microCredits, termDays: plan.term_days })},
          -- 'infinity' on a pack. The row is still worth writing: it is what
          -- records the purchase and carries the perks, and a pack's perks are
          -- exactly the ones that never lapse. The CHECK wants ends_at above
          -- starts_at, which infinity satisfies.
          ${microCredits}, ${lot!.id}, 'active',
          ${isPack(plan.term_days) ? tx`'infinity'::timestamptz` : tx`now() + (${plan.term_days} * interval '1 day')`}
        )
        returning id, ${plan.code} as plan_code, ${plan.name} as plan_name, ${plan.tier}::smallint as tier,
                  micro_credits_granted, starts_at, ends_at, status
      `;

      /* On the ledger like every other movement of credit. An off-ledger grant
         would balance today and break the reconciliation that proves nothing
         has been lost — which is the one report this system can produce that a
         customer's own arithmetic can be checked against. */
      const [balance] = await tx<{ total: string }[]>`
        select coalesce(sum(micro_credits_remaining), 0)::text as total
        from credit_lots where account_id = ${input.accountId}
      `;
      await tx`
        insert into credit_ledger (account_id, lot_id, entry_type, micro_credits, balance_after, ref_type, ref_id, note, created_by)
        values (${input.accountId}, ${lot!.id}, 'grant', ${microCredits}, ${balance!.total}, 'order', ${subscription!.id},
                ${input.note ?? `plan ${plan.code} granted by staff`}, ${input.grantedBy})
      `;

      return { outcome: "granted" as const, grant: toGrant(subscription!, coinsOf(microCredits)) };
    });
  }

  /**
   * Turn it off again.
   *
   * The subscription is cancelled and the term's credits are expired with it.
   * Leaving the lot behind would mean "deactivating" a plan left the account
   * holding the month's coins, which is not what anybody pressing that button
   * means — and the credits were granted *because* of the plan.
   *
   * Spent credits are not clawed back. The ledger records what was granted and
   * what was spent, and reversing a capture that already paid for a generation
   * somebody has is a different, harder question than this button asks.
   */
  async revoke(accountId: string, revokedBy: string): Promise<{ outcome: "revoked" | "not_active"; coinsWithdrawn: number }> {
    return atomically(this.sql)(async (tx) => {
      const [subscription] = await tx<{ id: string; lot_id: string | null }[]>`
        update subscriptions set status = 'cancelled', cancelled_at = now(), updated_at = now()
        where account_id = ${accountId} and status = 'active' and ends_at > now()
        returning id, lot_id
      `;
      if (!subscription) return { outcome: "not_active" as const, coinsWithdrawn: 0 };
      if (!subscription.lot_id) return { outcome: "revoked" as const, coinsWithdrawn: 0 };

      /* Read the remaining amount before zeroing it, and lock the row while
         doing so. `UPDATE ... RETURNING` would hand back the new value — the
         zero this statement just wrote — which is exactly the shape of bug
         that makes a withdrawal look like it moved nothing. */
      const [lot] = await tx<{ micro_credits_remaining: string }[]>`
        select micro_credits_remaining from credit_lots where id = ${subscription.lot_id} for update
      `;
      const withdrawn = Number(lot?.micro_credits_remaining ?? 0);
      // Nothing left is a normal outcome rather than a failure: the account
      // spent the term's allowance, which is what it was for.
      if (withdrawn <= 0) return { outcome: "revoked" as const, coinsWithdrawn: 0 };

      await tx`
        update credit_lots set micro_credits_remaining = 0, expires_at = now()
        where id = ${subscription.lot_id}
      `;

      const [balance] = await tx<{ total: string }[]>`
        select coalesce(sum(micro_credits_remaining), 0)::text as total
        from credit_lots where account_id = ${accountId}
      `;
      await tx`
        insert into credit_ledger (account_id, lot_id, entry_type, micro_credits, balance_after, ref_type, ref_id, note, created_by)
        values (${accountId}, ${subscription.lot_id}, 'expiry', ${-withdrawn}, ${balance!.total}, 'order', ${subscription.id},
                'plan deactivated by staff', ${revokedBy})
      `;
      return { outcome: "revoked" as const, coinsWithdrawn: withdrawn / 100 };
    });
  }
}
