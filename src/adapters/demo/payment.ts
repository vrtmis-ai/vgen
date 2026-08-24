import type { AppServices } from "../../runtime/AppServices";
import type { CheckoutOrder } from "../../runtime/contracts/payment";
import { annualTotalUsd, effectiveUsd, toman } from "../../data/plans";
import { PLAN_LADDER } from "../../data/planLadder";

/**
 * Demo checkout. Records an order and hands back no gateway, because there is
 * no gateway to hand back — demo mode has no server holding a Zibal merchant
 * key, and sending someone to a real payment page from a fake order would be
 * the one kind of pretending this mode must not do.
 *
 * The sheet reads `gatewayUrl: null` and stops on a neutral notice, so the whole
 * flow up to the handoff is still walkable without a backend.
 *
 * Prices off PLAN_LADDER — the database's own export, the same document
 * createDemoPlansService serves. Reading the seed file instead would let demo
 * mode quote one number on the card and a different one at checkout.
 */
export function createDemoPaymentService(now: () => number): AppServices["payment"] {
  let sequence = 0;
  return {
    createOrder: async ({ planId, cycle }) => {
      const plan = PLAN_LADDER.find((row) => row.code === planId);
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
