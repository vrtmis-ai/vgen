import { z } from "zod";

/**
 * A checkout order — what the server hands back when someone confirms a plan.
 *
 * The browser never talks to the gateway itself and never sees an amount it
 * chose. It names a plan and a cycle; the server prices it, reserves that
 * price, registers the payment and answers with somewhere to send the person.
 * Pricing on the client would mean the figure on the confirmation and the
 * figure that gets charged are two different calculations that have to agree.
 *
 * `gatewayUrl` is where the browser goes next. With Zibal that is
 * `https://gateway.zibal.ir/start/{trackId}` — the server has already POSTed
 * the amount and its own callback to Zibal by the time this is answered, so
 * swapping gateways changes this one string and nothing on this side.
 *
 * Null means the order is recorded but there is no gateway to hand off to
 * (demo mode, or a plan a person already owns). The sheet stops and says so
 * rather than sending anyone to a URL that is not a payment page.
 */
export const CheckoutOrderSchema = z.object({
  orderId: z.string().min(1),
  amountToman: z.number().int().nonnegative(),
  gatewayUrl: z.string().url().nullable(),
});

export type CheckoutOrder = z.infer<typeof CheckoutOrderSchema>;

export const CHECKOUT_CYCLES = ["monthly", "annual"] as const;

export interface CreateCheckoutOrderInput {
  planId: string;
  cycle: (typeof CHECKOUT_CYCLES)[number];
}
