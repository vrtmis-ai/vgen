import { z } from "zod";

/** The two ways a plan is paid for. Annual is a cadence, not a longer term. */
export const CHECKOUT_CYCLES = ["monthly", "annual"] as const;

/**
 * What the browser is allowed to say when someone confirms a plan.
 *
 * A plan and a cadence, and deliberately nothing else — above all, no amount.
 * If the browser sent the figure it displayed, the sum shown and the sum
 * charged would be two calculations that have to agree, and the one the
 * customer could edit would be the one that won.
 */
export const CreateCheckoutOrderRequestSchema = z.object({
  planId: z.string().min(1),
  cycle: z.enum(CHECKOUT_CYCLES),
});

/**
 * The order the server registered, and where to send the person next.
 *
 * `amountToman` is Toman rather than the Rial the column stores, because Toman
 * is what an Iranian customer is quoted in and the sheet cross-checks this
 * figure against the one it displayed. A mismatch is surfaced before anybody
 * pays rather than reconciled afterwards.
 *
 * `gatewayUrl` is null when the order is recorded and there is nowhere to hand
 * off to. The sheet stops on a neutral notice; it does not congratulate anyone,
 * because nothing has been bought.
 */
export const CheckoutOrderSchema = z.object({
  orderId: z.string().min(1),
  amountToman: z.number().int().nonnegative(),
  gatewayUrl: z.string().url().nullable(),
});

export type CheckoutCycle = (typeof CHECKOUT_CYCLES)[number];
export type CheckoutOrder = z.infer<typeof CheckoutOrderSchema>;
export type CreateCheckoutOrderRequest = z.infer<typeof CreateCheckoutOrderRequestSchema>;
