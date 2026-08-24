import { z } from "zod";

/**
 * A running price campaign, as `GET /campaigns/active` serves it.
 *
 * `endsAt` is an absolute epoch-milliseconds instant and never a remaining
 * duration. That is the whole reason this route exists: a duration handed to
 * the browser restarts on every reload, so the countdown never reaches zero and
 * the "limited time" printed beside it is not true.
 *
 * `maxDiscountPct` and `maxBonusCoins` are the headline numbers the strip
 * prints, which is why the server decides them rather than the copy. They are
 * derived from the same plan rows checkout prices from, so the strip cannot
 * advertise a rate the till will not honour — see `campaignsRepository.ts`.
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
