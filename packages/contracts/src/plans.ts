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
  /**
   * Perk tier.
   *
   * It no longer decides what may run — no model is locked to a plan any more,
   * and the only gate left on a generation is whether the wallet can pay for
   * it. What this still decides is the unlimited pipe: an entitlement names the
   * lowest tier it opens to, and `unlimitedDays` says how long that stays open.
   */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Coins granted each term — the total, bonus included. */
  coinsPerTerm: z.number().int().nonnegative(),
  /** The same total, split the way the card shows it: "500 + 25". */
  baseCoins: z.number().int().nonnegative(),
  bonusCoins: z.number().int().nonnegative(),
  /** Days a term lasts. 0 = a pack: the coins never expire and nothing lapses. */
  termDays: z.number().int().nonnegative(),
  /**
   * Days from purchase that the unlimited pipe is open to this plan. 0 = never.
   *
   * Pro carries seven days of it, Studio and Creator a month. Time-boxed
   * because the free pipe is a shared pool of upstream subscriptions: a perk
   * with no end is paid for out of every other customer's queue.
   */
  unlimitedDays: z.number().int().nonnegative().default(0),
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

/**
 * What one dollar costs in Toman right now.
 *
 * Served beside the ladder rather than baked into each row, because it is one
 * fact about today and not a property of a plan — and because the screens
 * apply it to figures the server cannot precompute, like a campaign discount
 * that depends on the account asking.
 *
 * The database stores Rial; this is that over ten, kept a whole number so the
 * price this rounds to and the price the checkout reserves round the same way.
 */
export const PlansResponseSchema = PlanListSchema.extend({
  tomanPerUsd: z.number().positive(),
});

export type Plan = z.infer<typeof PlanSchema>;
export type PlanList = z.infer<typeof PlanListSchema>;
export type PlansResponse = z.infer<typeof PlansResponseSchema>;
