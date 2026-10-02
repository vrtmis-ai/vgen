import * as z from "./z";

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

/**
 * Every status an order row can hold, straight from the table's own CHECK.
 *
 * `cancelled` is in here although nothing writes it today. The browser parses
 * this list, so a status the schema does not know would not degrade to an odd
 * label — it would fail the parse and take the whole purchase history off the
 * page. A gateway that learns to cancel an order should not be able to do that.
 */
export const ORDER_STATUSES = ["pending", "paid", "failed", "cancelled", "refunded"] as const;

/**
 * One purchase, as the account page lists it.
 *
 * `amountToman` again rather than the Rial the column stores, for the same
 * reason `CheckoutOrderSchema` does it: Toman is what the customer was quoted,
 * and a history that disagrees with the receipt by a factor of ten is worse
 * than no history. `coins` is the credit the order bought, in coins.
 *
 * `planCode` is absent on an order that bought a coin pack rather than a plan.
 */
export const PaidOrderSchema = z.object({
  id: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  status: z.enum(ORDER_STATUSES),
  amountToman: z.number().nonnegative(),
  coins: z.number().nonnegative(),
  planCode: z.string().min(1).optional(),
});

export const PaidOrderListSchema = z.array(PaidOrderSchema);

export type CheckoutCycle = (typeof CHECKOUT_CYCLES)[number];
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type PaidOrder = z.infer<typeof PaidOrderSchema>;
export type CheckoutOrder = z.infer<typeof CheckoutOrderSchema>;
export type CreateCheckoutOrderRequest = z.infer<typeof CreateCheckoutOrderRequestSchema>;
