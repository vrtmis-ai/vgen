import { z } from "zod";

/**
 * A running price campaign — the thing the plans banner counts down to.
 *
 * `endsAt` is an absolute epoch milliseconds, not a duration, and that is the
 * whole point of this contract. A duration handed to the browser restarts on
 * every reload, so the countdown it drives never actually reaches zero and the
 * "last chance" it sits under is not true. An absolute instant can only be
 * counted down once.
 *
 * The server decides the headline numbers too. `maxDiscountPct` and
 * `maxBonusCoins` are what the banner prints, so the copy cannot drift away
 * from what the checkout will charge.
 */
export const CampaignSchema = z.object({
  id: z.string().min(1),
  endsAt: z.number().int().nonnegative(),
  maxDiscountPct: z.number().int().min(0).max(100),
  maxBonusCoins: z.number().int().nonnegative(),
});

/** Null is the ordinary answer: most of the year there is no campaign. */
export const ActiveCampaignSchema = CampaignSchema.nullable();

export type Campaign = z.infer<typeof CampaignSchema>;
