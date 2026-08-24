import { CheckoutOrderSchema, CreateCheckoutOrderRequestSchema } from "@vgen/contracts";
import type { CreateOrderInput, CreateOrderOutcome } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { CustomerSessionApplication } from "./session";

export interface CheckoutApplication {
  createOrder(input: CreateOrderInput): Promise<CreateOrderOutcome>;
}

/**
 * Checkout: name a plan, get back a priced order.
 *
 * The body is a plan and a cadence and nothing else. The browser never sends an
 * amount, so the sum shown and the sum charged are not two calculations that
 * have to agree — there is one, and it happens on this side of the wire.
 *
 * `gatewayUrl` is null today and the contract has always allowed that: the
 * order is recorded and there is nowhere to send the person, so the sheet stops
 * on a neutral notice instead of navigating. It stays null until a gateway is
 * chosen — ZarinPal, IDPay, NextPay and Zibal differ enough that the choice
 * comes before the integration. When one is picked, the registration call goes
 * between the insert and this reply and nothing else here changes.
 */
export function registerPaymentRoutes(app: FastifyInstance, sessions: CustomerSessionApplication, checkout: CheckoutApplication): void {
  app.post("/api/v1/payments/orders", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const body = CreateCheckoutOrderRequestSchema.parse(request.body);
    const result = await checkout.createOrder({ userId: session.user.id, planCode: body.planId, cycle: body.cycle });

    if (result.outcome === "ordered") {
      // 201: unlike a community share, this one really did create the thing the
      // caller asked for, and the caller can go straight to it.
      return reply.code(201).send(CheckoutOrderSchema.parse({ ...result.order, gatewayUrl: null }));
    }

    if (result.outcome === "unknown_plan") {
      return reply.code(404).send({ error: { code: result.outcome, message: "That plan is not on sale." } });
    }

    if (result.outcome === "no_annual_option") {
      return reply.code(409).send({ error: { code: result.outcome, message: "That plan is not sold annually." } });
    }

    // Both of the last two are ours to fix and neither is the customer's fault,
    // so they read as a service fault rather than a bad request. A missing
    // exchange rate is an unconfigured deployment; a user with no account is a
    // broken signup. Answering 4xx would send someone to change something they
    // control, and nothing they control would help.
    return reply.code(503).send({
      error: { code: result.outcome, message: "Checkout is unavailable right now. Please try again shortly." },
    });
  });
}
