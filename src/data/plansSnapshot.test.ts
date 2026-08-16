import { describe, expect, it } from "vitest";
import snapshot from "./plans.snapshot.json";
import { PLANS, monthlyCoins, type Plan } from "./plans";

/**
 * Half of a two-part guarantee, and neither half is worth much alone.
 *
 * This half is offline: the committed snapshot says the same thing as the plan
 * ladder the screens render. The other half runs in CI against a real database
 * — reseed, re-export, diff — and says the database serves this snapshot.
 * Together they mean the table bills exactly what the card advertises, which is
 * the one thing a pricing page must never get wrong.
 */
interface SnapshotPlan {
  code: string;
  name: string;
  tier: 1 | 2 | 3;
  coinsPerTerm: number;
  baseCoins: number;
  bonusCoins: number;
  termDays: number;
  monthlyUsd: number;
  annualUsdPerMonth: number | null;
  group: "entry" | "main";
  tag?: string;
  popular: boolean;
  maxConcurrentJobs: number;
}

const plans = (snapshot as { plans: SnapshotPlan[] }).plans;
const byCode = new Map(plans.map((plan) => [plan.code, plan]));

describe("the committed plan snapshot", () => {
  it("covers every plan on the ladder, in the same order", () => {
    expect(plans.map((plan) => plan.code)).toEqual(PLANS.map((plan) => plan.id));
  });

  it.each(PLANS.map((plan): [string, Plan] => [plan.id, plan]))("matches %s coin for coin", (code, plan) => {
    const stored = byCode.get(code);
    expect(stored).toBeDefined();

    // The number a customer is buying. If only one assertion survived, this one.
    expect(stored?.coinsPerTerm).toBe(monthlyCoins(plan));
    expect(stored?.baseCoins).toBe(plan.coinsPerMonth);
    expect(stored?.bonusCoins).toBe(plan.bonus);
    expect(stored?.monthlyUsd).toBe(plan.monthlyUsd);
    expect(stored?.annualUsdPerMonth).toBe(plan.annualUsdPerMonth ?? null);
    expect(stored?.tier).toBe(plan.tier);
    expect(stored?.name).toBe(plan.name);
    expect(stored?.group).toBe(plan.group);
    expect(stored?.tag).toBe(plan.tag);
    expect(stored?.popular).toBe(plan.popular ?? false);
    expect(stored?.maxConcurrentJobs).toBe(plan.maxConcurrentJobs);
  });

  // Paying more must never buy you less parallelism. The coins ladder has an
  // audit for exactly this inversion (`auditPlans`) because it shipped broken
  // once; this is the same rule for the other thing a plan sells.
  it("never lets a dearer plan run fewer generations at once", () => {
    const byPrice = [...PLANS].sort((a, b) => a.monthlyUsd - b.monthlyUsd);
    for (let i = 1; i < byPrice.length; i++) {
      const cheaper = byPrice[i - 1]!;
      const dearer = byPrice[i]!;
      expect(dearer.maxConcurrentJobs).toBeGreaterThanOrEqual(cheaper.maxConcurrentJobs);
    }
  });

  // Annual is a payment cadence, not a longer grant: twelve months are paid up
  // front but coins still arrive monthly and still expire after thirty days,
  // which is where the annual margin comes from. A 365-day term here would mean
  // someone gets a year of coins on day one.
  it("grants monthly on every plan, annual ones included", () => {
    for (const plan of plans) expect(plan.termDays).toBe(30);
  });
});
