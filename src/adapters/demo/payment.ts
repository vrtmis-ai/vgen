import type { AppServices } from "../../runtime/AppServices";
import type { CheckoutOrder } from "../../runtime/contracts/payment";
import { SEED_TOMAN_PER_USD, annualTotalUsd, effectiveUsd, toman } from "../../data/plans";
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
    /* No `GET /payments/orders` on the server yet — see #143. Answered here so
       the history card can be built; the http adapter calls the route and the
       card hides itself until it answers. */
    async orders() {
      const day = 86_400_000;
      return [
        { id: "ord-3", createdAt: now() - 2 * day, status: "paid" as const, amountToman: 4_250_000, coins: 525, planCode: "plus" },
        { id: "ord-2", createdAt: now() - 40 * day, status: "paid" as const, amountToman: 1_275_000, coins: 150, planCode: "basic" },
        { id: "ord-1", createdAt: now() - 41 * day, status: "failed" as const, amountToman: 1_275_000, coins: 150, planCode: "basic" },
      ];
    },
    createOrder: async ({ planId, cycle }) => {
      const plan = PLAN_LADDER.find((row) => row.code === planId);
      if (!plan) throw new Error(`Unknown plan: ${planId}`);
      const annual = cycle === "annual" && plan.annualUsdPerMonth != null;
      const usd = annual ? (annualTotalUsd(plan) ?? effectiveUsd(plan, false)) : effectiveUsd(plan, false);
      const order: CheckoutOrder = {
        orderId: `demo-${now()}-${++sequence}`,
        // Demo mode has no `fx_rates`; `createDemoPlansService` quotes the
        // same seed rate, so the sheet and this order agree.
        amountToman: toman(usd, SEED_TOMAN_PER_USD),
        gatewayUrl: null,
      };
      return order;
    },
  };
}
