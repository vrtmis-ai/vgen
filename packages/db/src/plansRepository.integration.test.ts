import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresPlansRepository } from "./plansRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/** The presentation blob, spelled out — `Record<string, unknown>` is not JSON to the driver. */
interface Presentation {
  group: "entry" | "main";
  popular: boolean;
  baseCoins: number;
  bonusCoins: number;
  tag?: string;
}

interface PlanOverrides {
  code: string;
  tier?: number;
  coins?: number;
  usd?: number;
  annualUsd?: number | null;
  sortOrder?: number;
  isPublic?: boolean;
  isActive?: boolean;
  presentation?: Presentation;
}

/**
 * Start from an empty ladder.
 *
 * The database these run against has the real seven plans in it, seeded by
 * `pnpm plans:publish` — so without this, `list()` returns them alongside the
 * fixtures and every ordering assertion is about the wrong rows. Safe because
 * `inRollback` throws the whole transaction away afterwards.
 *
 * Subscriptions go first. `plans` is referenced by every purchase, so deleting
 * plans alone works only against a database nobody has ever bought anything
 * on — which is true of a fresh CI container and false of any machine someone
 * has actually signed in and quoted on. Failing there is a worse bug than it
 * looks, because it fails in `clearPlans` and reads as nine broken plan tests
 * rather than as one stale row.
 */
async function clearPlans(tx: Sql): Promise<void> {
  await tx`delete from subscriptions`;
  await tx`delete from plans`;
}

async function seedPlan(tx: Sql, plan: PlanOverrides): Promise<void> {
  const coins = plan.coins ?? 100;
  const presentation: Presentation = plan.presentation ?? { group: "entry", popular: false, baseCoins: coins, bonusCoins: 0 };
  await tx`
    insert into plans (
      code, name, tier, micro_credits_per_term, term_days,
      price_amount, currency, annual_price_amount, presentation,
      sort_order, is_public, is_active
    ) values (
      ${plan.code}, ${plan.code.toUpperCase()}, ${plan.tier ?? 1}, ${coins * 1_000_000}, 30,
      ${plan.usd ?? 10}, 'USD', ${plan.annualUsd ?? null}, ${tx.json({ ...presentation })},
      ${plan.sortOrder ?? 0}, ${plan.isPublic ?? true}, ${plan.isActive ?? true}
    )
  `;
}

describe("listing the ladder", () => {
  it("returns public, active plans in card order", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "second", sortOrder: 2 });
      await seedPlan(tx, { code: "first", sortOrder: 1 });

      const plans = await new PostgresPlansRepository(tx).list();

      // Deliberately inserted out of order: sort_order is what the cards read,
      // and a set has none of its own.
      expect(plans.map((plan) => plan.code)).toEqual(["first", "second"]);
    });
  });

  it("hides a retired plan and a private one", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "on-sale" });
      await seedPlan(tx, { code: "retired", isActive: false });
      await seedPlan(tx, { code: "internal", isPublic: false });

      const plans = await new PostgresPlansRepository(tx).list();

      expect(plans.map((plan) => plan.code)).toEqual(["on-sale"]);
    });
  });

  it("splits the coin total the way the card shows it", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, {
        code: "plus",
        coins: 525,
        presentation: { group: "entry", popular: false, baseCoins: 500, bonusCoins: 25, tag: "gift" },
      });

      const [plan] = await new PostgresPlansRepository(tx).list();

      // The grant is the total; the split is what makes the volume discount
      // visible on the card. Both have to survive the round trip.
      expect(plan?.coinsPerTerm).toBe(525);
      expect(plan?.baseCoins).toBe(500);
      expect(plan?.bonusCoins).toBe(25);
      expect(plan?.tag).toBe("gift");
    });
  });

  it("keeps a missing annual price as null rather than copying the monthly one", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "monthly-only", usd: 25, annualUsd: null });
      await seedPlan(tx, { code: "both", usd: 49, annualUsd: 39, sortOrder: 1 });

      const plans = await new PostgresPlansRepository(tx).list();

      // Null hides the annual toggle; equal prices would show a discount of
      // zero. They are different answers and must not collapse into one.
      expect(plans.find((p) => p.code === "monthly-only")?.annualUsdPerMonth).toBeNull();
      expect(plans.find((p) => p.code === "both")?.annualUsdPerMonth).toBe(39);
    });
  });
});

describe("the access tier", () => {
  it("reads the tier a plan grants", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "studio", tier: 3 });

      expect(await new PostgresPlansRepository(tx).tierFor("studio")).toBe(3);
    });
  });

  // An account with no plan still gets tier 1: it holds a signup gift, and the
  // cheapest tier-1 models cost about a coin, so tier 1 is what makes that gift
  // spendable rather than a number on a screen.
  it("gives an account with no plan tier 1", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      const repository = new PostgresPlansRepository(tx);

      expect(await repository.tierFor(null)).toBe(1);
      expect(await repository.tierFor(undefined)).toBe(1);
    });
  });

  // Failing closed here would lock a paying customer out of everything over a
  // stale code, which is worse than briefly under-gating one.
  it("falls back to tier 1 for a plan code it does not know", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      expect(await new PostgresPlansRepository(tx).tierFor("no-such-plan")).toBe(1);
    });
  });
});

describe("what a lock should point at", () => {
  it("names the cheapest plan that reaches the tier, not the next tier up", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "plus", tier: 1, usd: 25, sortOrder: 1 });
      await seedPlan(tx, { code: "pro", tier: 2, usd: 49, sortOrder: 2 });
      await seedPlan(tx, { code: "studio", tier: 3, usd: 99, sortOrder: 3 });

      const repository = new PostgresPlansRepository(tx);

      // Tiers are not a price ladder — Plus is tier 1 at $25 while Pro is tier 2
      // at $49 — so the answer has to be chosen by price, not by tier.
      expect((await repository.cheapestForTier(2))?.code).toBe("pro");
      expect((await repository.cheapestForTier(1))?.code).toBe("plus");
    });
  });

  it("returns null when nothing reaches the tier", async () => {
    await inRollback(sql, async (tx) => {
      await clearPlans(tx);
      await seedPlan(tx, { code: "basic", tier: 1 });

      expect(await new PostgresPlansRepository(tx).cheapestForTier(3)).toBeNull();
    });
  });
});
