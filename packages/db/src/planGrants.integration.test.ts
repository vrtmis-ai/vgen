import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPlanGrantsRepository } from "./planGrantsRepository";
import { PostgresWalletRepository } from "./walletRepository";
import { connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/* ---------------------------------------------------------------------------
   Turning a plan on for an account that has not paid for it.

   The requirement this was built for is one sentence: a main admin can activate
   a plan for a lower-level admin, "but it should still have the monthly limit".
   That sentence is the whole test.

   The limit is not a rule the code remembers to apply. It is what one term of a
   plan *is* — a lot of credits that expires when the term does — so the
   assertions below are about the lot and the ledger rather than about a counter
   somewhere. If the lot were unbounded, or had no expiry, or were not on the
   ledger, "unlimited access for staff" is what would have been built instead.
   --------------------------------------------------------------------------- */

/** A real, active plan out of the seeded ladder. */
async function anyPlan(tx: Sql) {
  const [plan] = await tx<{ code: string; micro_credits_per_term: string; term_days: number; tier: number }[]>`
    select code, micro_credits_per_term, term_days, tier
    from plans where is_active and micro_credits_per_term > 0 order by tier limit 1
  `;
  if (!plan) throw new Error("the seeded plan ladder has no active priced plan");
  return plan;
}

describe("granting a plan", () => {
  it("gives the account exactly one term's credits, and no more", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);

      const result = await new PostgresPlanGrantsRepository(tx).grant({ accountId, planCode: plan.code, grantedBy: userId });

      expect(result.outcome).toBe("granted");
      const [lot] = await tx<{ micro_credits_total: string; expires_at: Date | null; source: string }[]>`
        select micro_credits_total, expires_at, source from credit_lots
        where account_id = ${accountId} and source = 'admin_grant'
      `;
      // The ceiling, and the thing that makes it a month rather than forever.
      expect(lot?.micro_credits_total).toBe(plan.micro_credits_per_term);
      expect(lot?.expires_at).toBeInstanceOf(Date);
    });
  });

  it("expires the credits when the term does", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);

      await new PostgresPlanGrantsRepository(tx).grant({ accountId, planCode: plan.code, grantedBy: userId });

      const [row] = await tx<{ same: boolean }[]>`
        select date_trunc('minute', lot.expires_at) = date_trunc('minute', sub.ends_at) as same
        from credit_lots lot
        join subscriptions sub on sub.lot_id = lot.id
        where lot.account_id = ${accountId}
      `;
      // Credits that outlive the plan they came with would hand somebody a
      // free month every time a grant was turned off and on again.
      expect(row?.same).toBe(true);
    });
  });

  it("opens the tier gate, which is what the plan is for", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);

      await new PostgresPlanGrantsRepository(tx).grant({ accountId, planCode: plan.code, grantedBy: userId });

      // Read through the wallet, which is what the app actually asks, rather
      // than by re-deriving the tier here and testing our own arithmetic.
      const wallet = await new PostgresWalletRepository(tx).getCurrent(userId);
      expect(wallet.tier).toBe(plan.tier);
      expect(wallet.spendable).toBeGreaterThan(0);
    });
  });

  it("puts the grant on the ledger", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);

      await new PostgresPlanGrantsRepository(tx).grant({ accountId, planCode: plan.code, grantedBy: userId });

      const [entry] = await tx<{ entry_type: string; micro_credits: string; created_by: string | null }[]>`
        select entry_type, micro_credits, created_by from credit_ledger
        where account_id = ${accountId} and entry_type = 'grant'
      `;
      // An off-ledger grant balances today and breaks the reconciliation that
      // proves nothing has been lost.
      expect(entry?.micro_credits).toBe(plan.micro_credits_per_term);
      expect(entry?.created_by).toBe(userId);
    });
  });

  it("refuses to stack a second plan on a live one", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);
      const grants = new PostgresPlanGrantsRepository(tx);
      await grants.grant({ accountId, planCode: plan.code, grantedBy: userId });

      const again = await grants.grant({ accountId, planCode: plan.code, grantedBy: userId });

      // Two terms' credits from pressing the button twice is the bug this
      // refusal exists to prevent.
      expect(again.outcome).toBe("already_active");
      const [lots] = await tx<{ n: string }[]>`
        select count(*)::text as n from credit_lots where account_id = ${accountId} and source = 'admin_grant'
      `;
      expect(lots?.n).toBe("1");
    });
  });

  it("says so when the plan does not exist", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      expect((await new PostgresPlanGrantsRepository(tx).grant({ accountId, planCode: "no-such-plan", grantedBy: userId })).outcome).toBe(
        "unknown_plan",
      );
    });
  });
});

describe("taking a plan back", () => {
  it("cancels the subscription and withdraws what is left of the term", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);
      const grants = new PostgresPlanGrantsRepository(tx);
      await grants.grant({ accountId, planCode: plan.code, grantedBy: userId });

      const result = await grants.revoke(accountId, userId);

      expect(result.outcome).toBe("revoked");
      // Leaving the credits behind would mean "deactivate" left the account
      // holding the month's coins, which is not what pressing it means.
      expect(result.coinsWithdrawn).toBeCloseTo(Number(plan.micro_credits_per_term) / 100);
      expect(await grants.activeFor(accountId)).toBeNull();
      expect((await new PostgresWalletRepository(tx).getCurrent(userId)).tier).toBe(1);
    });
  });

  it("records the withdrawal on the ledger with the amount that moved", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);
      const grants = new PostgresPlanGrantsRepository(tx);
      await grants.grant({ accountId, planCode: plan.code, grantedBy: userId });

      await grants.revoke(accountId, userId);

      const [entry] = await tx<{ micro_credits: string; balance_after: string }[]>`
        select micro_credits, balance_after from credit_ledger
        where account_id = ${accountId} and entry_type = 'expiry'
      `;
      // Signed negative, and the real amount rather than a zero — the shape of
      // bug where the row is written after the value it should carry is gone.
      expect(entry?.micro_credits).toBe(`-${plan.micro_credits_per_term}`);
    });
  });

  it("is a no-op on an account with no plan", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      expect((await new PostgresPlanGrantsRepository(tx).revoke(accountId, userId)).outcome).toBe("not_active");
    });
  });

  it("lets a plan be granted again once the old one is off", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      const plan = await anyPlan(tx);
      const grants = new PostgresPlanGrantsRepository(tx);
      await grants.grant({ accountId, planCode: plan.code, grantedBy: userId });
      await grants.revoke(accountId, userId);

      // The next term is another grant. That is what makes the limit monthly
      // rather than a one-off.
      expect((await grants.grant({ accountId, planCode: plan.code, grantedBy: userId })).outcome).toBe("granted");
    });
  });
});
