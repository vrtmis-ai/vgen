import { z } from "zod";

/**
 * The plan ladder, as `GET /plans` serves it.
 *
 * Deliberately a copy of `packages/contracts/src/plans.ts` rather than an
 * import of it: this is the browser's statement of what it will accept, and the
 * server's is what it promises to send. They agree today, and the day they stop
 * agreeing the parse fails loudly here instead of a screen rendering a field
 * that quietly changed meaning.
 */
export const PlanSchema = z.object({
  /** Stable identifier. What a subscription and an order point at. */
  code: z.string().min(1),
  name: z.string().min(1),
  /** Access tier, compared against a family's `minTier`. Never defaulted. */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Coins granted each term — the total, bonus included. Charge against this. */
  coinsPerTerm: z.number().int().nonnegative(),
  /** The same total split the way the card shows it: "500 + 25". */
  baseCoins: z.number().int().nonnegative(),
  bonusCoins: z.number().int().nonnegative(),
  /**
   * 30 on every plan, annual ones included. Annual is a payment cadence, not a
   * longer grant — a year is paid up front and the coins still arrive monthly.
   */
  termDays: z.number().int().positive(),
  monthlyUsd: z.number().nonnegative(),
  /**
   * Per-month price when twelve months are paid up front, or null when the plan
   * has no annual option. Null and "the same as monthly" are different answers:
   * one hides the toggle, the other advertises a discount of zero.
   */
  annualUsdPerMonth: z.number().positive().nullable(),
  group: z.enum(["entry", "main"]),
  tag: z.enum(["test", "gift", "popular", "best"]).optional(),
  popular: z.boolean(),
  /** Generations this plan may have in flight at once. Enforced by the API. */
  maxConcurrentJobs: z.number().int().positive(),
});

/**
 * Order is meaningful and guaranteed — the order the cards are meant to read.
 * Do not sort it.
 */
export const PlanListSchema = z.object({ plans: z.array(PlanSchema).min(1) });

export type Plan = z.infer<typeof PlanSchema>;
export type PlanList = z.infer<typeof PlanListSchema>;

/** Access tier a plan grants. Families declare the minimum tier that unlocks them. */
export type Tier = Plan["tier"];
