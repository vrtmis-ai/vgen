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
  });

  // Annual is a payment cadence, not a longer grant: twelve months are paid up
  // front but coins still arrive monthly and still expire after thirty days,
  // which is where the annual margin comes from. A 365-day term here would mean
  // someone gets a year of coins on day one.
  it("grants monthly on every plan, annual ones included", () => {
    for (const plan of plans) expect(plan.termDays).toBe(30);
  });
});
