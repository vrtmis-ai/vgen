import type { CreateOrderOutcome } from "@vgen/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerCampaignRoute } from "./campaigns";
import { registerPaymentRoutes } from "./payments";

const SIGNED_IN = { status: "authed" as const, user: { id: "11111111-1111-4111-8111-111111111111" } };
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

function paymentsApp(outcome: CreateOrderOutcome, identity: unknown = SIGNED_IN) {
  const createOrder = vi.fn(async () => outcome);
  const app = Fastify({ logger: false });
  // The handler createApp installs, so a rejected body is the 400 the route
  // really answers rather than the 500 a bare Fastify would give.
  registerErrorHandling(app);
  registerPaymentRoutes(app, { getCurrent: vi.fn(async () => identity) } as never, { createOrder });
  return { app, createOrder };
}

const ordered = (): CreateOrderOutcome => ({ outcome: "ordered", order: { orderId: ORDER_ID, amountToman: 8_330_000 } });
const body = { planId: "pro", cycle: "monthly" };

describe("registering an order", () => {
  it("prices the plan server-side and answers with somewhere to go", async () => {
    const { app, createOrder } = paymentsApp(ordered());

    const response = await app.inject({ method: "POST", url: "/api/v1/payments/orders", payload: body });

    expect(response.statusCode).toBe(201);
    // gatewayUrl is null until a gateway is chosen. The sheet reads null as
    // "stop and say so", which is the honest state of Phase J — not an error.
    expect(response.json()).toEqual({ orderId: ORDER_ID, amountToman: 8_330_000, gatewayUrl: null });
    expect(createOrder).toHaveBeenCalledWith({ userId: SIGNED_IN.user.id, planCode: "pro", cycle: "monthly" });
  });

  it("refuses a stranger before it touches the database", async () => {
    const { app, createOrder } = paymentsApp(ordered(), { status: "anonymous" });

    const response = await app.inject({ method: "POST", url: "/api/v1/payments/orders", payload: body });

    expect(response.statusCode).toBe(401);
    expect(createOrder).not.toHaveBeenCalled();
  });

  /**
   * The one thing this route must never accept. If the browser could name an
   * amount, the sum displayed and the sum charged would be two calculations
   * that have to agree — and the editable one would win.
   */
  it("ignores an amount the browser tries to name", async () => {
    const { app, createOrder } = paymentsApp(ordered());

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/payments/orders",
      payload: { planId: "pro", cycle: "monthly", amountToman: 1000 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().amountToman).toBe(8_330_000);
    expect(createOrder).toHaveBeenCalledWith({ userId: SIGNED_IN.user.id, planCode: "pro", cycle: "monthly" });
  });

  it("will not take a body that names no plan or an invented cycle", async () => {
    const { app, createOrder } = paymentsApp(ordered());

    for (const payload of [{}, { planId: "pro" }, { planId: "pro", cycle: "weekly" }, { planId: "", cycle: "monthly" }]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/payments/orders", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("gives each refusal its own status, so the sheet can tell them apart", async () => {
    const cases: [CreateOrderOutcome["outcome"], number][] = [
      ["unknown_plan", 404],
      ["no_annual_option", 409],
      // Ours to fix, not the customer's: a 4xx would send someone to change
      // something they control, and nothing they control would help.
      ["no_exchange_rate", 503],
      ["no_account", 503],
    ];

    for (const [outcome, status] of cases) {
      const { app } = paymentsApp({ outcome } as CreateOrderOutcome);
      const response = await app.inject({ method: "POST", url: "/api/v1/payments/orders", payload: body });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(outcome);
    }
  });
});

function campaignApp(campaign: unknown) {
  const app = Fastify({ logger: false });
  registerErrorHandling(app);
  registerCampaignRoute(app, { getActive: vi.fn(async () => campaign) } as never);
  return app;
}

describe("reporting the running campaign", () => {
  it("is readable by a stranger, because the offer is what brings them in", async () => {
    const app = campaignApp({ id: "nowruz-1405", endsAt: 1_755_648_000_000, maxDiscountPct: 22, maxBonusCoins: 350 });

    const response = await app.inject({ method: "GET", url: "/api/v1/campaigns/active" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: "nowruz-1405", endsAt: 1_755_648_000_000, maxDiscountPct: 22, maxBonusCoins: 350 });
  });

  it("answers a plain null when nothing is running, which is most of the year", async () => {
    const response = await campaignApp(null).inject({ method: "GET", url: "/api/v1/campaigns/active" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toBeNull();
  });

  /**
   * The countdown subtracts this from `Date.now()`. A duration where an instant
   * belongs restarts on every reload, so the clock never reaches zero and the
   * "limited time" beside it is false — the bug this whole route replaces. The
   * schema is where that stops, so nothing malformed ever reaches the strip.
   *
   * The status is 4xx rather than 5xx because `registerErrorHandling` maps
   * every ZodError the same way and cannot see which side of the wire this one
   * came from. Misleading in a log, harmless on the screen: the browser rejects
   * the query either way and the strip does not render.
   */
  it("refuses to serve a remaining duration in place of an instant", async () => {
    const app = campaignApp({ id: "nowruz-1405", endsAt: -1, maxDiscountPct: 22, maxBonusCoins: 350 });

    const response = await app.inject({ method: "GET", url: "/api/v1/campaigns/active" });

    expect(response.statusCode).not.toBe(200);
    expect(response.json()).not.toHaveProperty("endsAt");
  });
});
