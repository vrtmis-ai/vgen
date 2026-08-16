import { z } from "zod";

/**
 * The plan ladder, as the Plans screen and the access gate see it.
 *
 * Prices are USD, matching the column. The Toman figure a customer sees is a
 * conversion applied at the edge — one rate, changed in one place, rather than
 * a second price on every row that can drift from the first.
 */
export const PlanSchema = z.object({
  /** Stable identifier. This is what a subscription and an order point at. */
  code: z.string().min(1),
  name: z.string().min(1),
  /** Access tier. Compared against a family's `minTier` to decide what may run. */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Coins granted each term — the total, bonus included. */
  coinsPerTerm: z.number().int().nonnegative(),
  /** The same total, split the way the card shows it: "500 + 25". */
  baseCoins: z.number().int().nonnegative(),
  bonusCoins: z.number().int().nonnegative(),
  termDays: z.number().int().positive(),
  monthlyUsd: z.number().nonnegative(),
  /**
   * Per-month price when twelve months are paid up front, or null when the plan
   * has no annual option. Null and "same as monthly" are different answers: one
   * hides the toggle, the other shows a discount of zero.
   */
  annualUsdPerMonth: z.number().positive().nullable(),
  group: z.enum(["entry", "main"]),
  tag: z.enum(["test", "gift", "popular", "best"]).optional(),
  popular: z.boolean(),
  /**
   * Generations this plan may have in flight at once.
   *
   * A perk the customer feels rather than a throttle: queueing behind your own
   * jobs is what a heavier plan buys you out of. Shown on the card, enforced by
   * the API at submission — never by the browser.
   */
  maxConcurrentJobs: z.number().int().positive(),
});

export const PlanListSchema = z.object({
  plans: z.array(PlanSchema),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanList = z.infer<typeof PlanListSchema>;
