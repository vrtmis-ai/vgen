import type { AppServices } from "../../runtime/AppServices";
import type { CheckoutOrder } from "../../runtime/contracts/payment";
import { PLANS, annualTotalUsd, effectiveUsd, toman } from "../../data/plans";

/**
 * Demo checkout. Records an order and hands back no gateway, because there is
 * no gateway to hand back — demo mode has no server holding a Zibal merchant
 * key, and sending someone to a real payment page from a fake order would be
 * the one kind of pretending this mode must not do.
 *
 * The sheet reads `gatewayUrl: null` and stops on a confirmed-order panel, so
 * the whole flow up to the handoff is still walkable without a backend.
 */
export function createDemoPaymentService(now: () => number): AppServices["payment"] {
  let sequence = 0;
  return {
    createOrder: async ({ planId, cycle }) => {
      const plan = PLANS.find((row) => row.id === planId);
      if (!plan) throw new Error(`Unknown plan: ${planId}`);
      const annual = cycle === "annual" && plan.annualUsdPerMonth != null;
      const usd = annual ? (annualTotalUsd(plan) ?? effectiveUsd(plan, false)) : effectiveUsd(plan, false);
      const order: CheckoutOrder = {
        orderId: `demo-${now()}-${++sequence}`,
        amountToman: toman(usd),
        gatewayUrl: null,
      };
      return order;
    },
  };
}
