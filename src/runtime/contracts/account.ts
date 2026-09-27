import { z } from "zod";

/**
 * The reads an account page wants and the server cannot answer yet.
 *
 * Every schema here describes a route that does not exist — see #142 and #143.
 * They live in one file rather than scattered through the others so that the
 * set is easy to find, and easy to delete if a shape is decided differently.
 *
 * The screens that use them follow `waitlistCount`'s rule, which this codebase
 * already settled: a call whose route is missing must degrade on its own. Each
 * section renders nothing when its query fails, so a deployment without the
 * route shows an account page with fewer cards rather than an error.
 */

/** One place this account is signed in. */
export const AccountSessionSchema = z.object({
  id: z.string().min(1),
  /** Whatever the server can say: "Chrome on macOS", a device name, a model. */
  device: z.string().min(1),
  ip: z.string().min(1).optional(),
  /** Coarse, and optional: a city is plenty to recognise yourself by. */
  city: z.string().min(1).optional(),
  lastSeenAt: z.number().int().nonnegative(),
  /**
   * The one being read on. It must be marked, or somebody ends their own
   * session trying to end someone else's — and then cannot get back to the
   * page to try again.
   */
  current: z.boolean(),
});

export const OrderStatusSchema = z.enum(["paid", "pending", "failed", "refunded"]);

/** One purchase. */
export const PaidOrderSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  status: OrderStatusSchema,
  /** In Toman, as charged — not converted at today's rate. */
  amountToman: z.number().nonnegative(),
  coins: z.number().nonnegative(),
  planCode: z.string().min(1).optional(),
});

/** What an account has earned by inviting people. */
export const ReferralSchema = z.object({
  code: z.string().min(1),
  invited: z.number().int().nonnegative(),
  coinsEarned: z.number().nonnegative(),
});

export type AccountSession = z.infer<typeof AccountSessionSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type PaidOrder = z.infer<typeof PaidOrderSchema>;
export type Referral = z.infer<typeof ReferralSchema>;
