import type { AppServices } from "../../runtime/AppServices";
import { CheckoutOrderSchema } from "../../runtime/contracts/payment";
import * as z from "../../lib/z";
import { PaidOrderSchema } from "../../runtime/contracts/account";
import type { HttpClient } from "./client";

export function createHttpPaymentService(client: HttpClient): AppServices["payment"] {
  return {
    /* No `GET` on the server yet — see #143. The card hides on failure. */
    orders(options) {
      return client.request("/payments/orders", { schema: z.array(PaidOrderSchema), signal: options?.signal });
    },
    createOrder(input, options) {
      return client.request("/payments/orders", {
        schema: CheckoutOrderSchema,
        method: "POST",
        body: input,
        signal: options?.signal,
      });
    },
  };
}
