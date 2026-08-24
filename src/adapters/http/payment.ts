import type { AppServices } from "../../runtime/AppServices";
import { CheckoutOrderSchema } from "../../runtime/contracts/payment";
import type { HttpClient } from "./client";

export function createHttpPaymentService(client: HttpClient): AppServices["payment"] {
  return {
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
