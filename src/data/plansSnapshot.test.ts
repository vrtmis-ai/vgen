import { describe, expect, it } from "vitest";
import rowList from "./plans.rows.json";
import { PLAN_LADDER } from "./planLadder";

/**
 * Half of a two-part guarantee, and neither half is worth much alone.
 *
 * This half is offline: the ladder the app renders — `plans.snapshot.json`, the
 * database's own export — says the same thing as `plans.rows.json`, the file the
 * seeder is fed. The other half runs in CI against a real database: reseed,
 * re-export, diff. Together they mean the table bills exactly what the card
 * advertises, which is the one thing a pricing page must never get wrong.
 *
 * It used to compare the snapshot against a `PLANS` array declared in
 * `plans.ts`. That array is gone — screens read `GET /plans` now — so the
 * comparison is between the seeder's input and its output, which is the step
 * that could actually drop a field.
 */
interface StoredPlan {
  code: string;
  name: string;
  tier: 1 | 2 | 3;
  baseCoins: number;
  bonusCoins: number;
  monthlyUsd: number;
  annualUsdPerMonth: number | null;
  group: "entry" | "main";
  tag: string | null;
  popular: boolean;
  sortOrder: number;
  maxConcurrentJobs: number;
}

const rows = (rowList as { rows: StoredPlan[] }).rows;
const byCode = new Map(PLAN_LADDER.map((plan) => [plan.code, plan]));

describe("the committed plan snapshot", () => {
  it("covers every seeded plan, in the order the rows declare", () => {
    const seeded = [...rows].sort((a, b) => a.sortOrder - b.sortOrder).map((row) => row.code);
    expect(PLAN_LADDER.map((plan) => plan.code)).toEqual(seeded);
  });

  it.each(rows.map((row): [string, StoredPlan] => [row.code, row]))("matches %s coin for coin", (code, row) => {
    const served = byCode.get(code);
    expect(served).toBeDefined();

    // The number a customer is buying. If only one assertion survived, this one.
    expect(served?.coinsPerTerm).toBe(row.baseCoins + row.bonusCoins);
    expect(served?.baseCoins).toBe(row.baseCoins);
    expect(served?.bonusCoins).toBe(row.bonusCoins);
    expect(served?.monthlyUsd).toBe(row.monthlyUsd);
    expect(served?.annualUsdPerMonth).toBe(row.annualUsdPerMonth);
    expect(served?.tier).toBe(row.tier);
    expect(served?.name).toBe(row.name);
    expect(served?.group).toBe(row.group);
    expect(served?.tag).toBe(row.tag ?? undefined);
    expect(served?.popular).toBe(row.popular);
    expect(served?.maxConcurrentJobs).toBe(row.maxConcurrentJobs);
  });

  // Paying more must never buy you less parallelism. The coins ladder has an
  // audit for exactly this inversion (`auditPlans`) because it shipped broken
  // once; this is the same rule for the other thing a plan sells.
  it("never lets a dearer plan run fewer generations at once", () => {
    const byPrice = [...PLAN_LADDER].sort((a, b) => a.monthlyUsd - b.monthlyUsd);
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
    for (const plan of PLAN_LADDER) expect(plan.termDays).toBe(30);
  });
});
