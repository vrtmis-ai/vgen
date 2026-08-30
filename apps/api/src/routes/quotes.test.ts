import type { QuoteResult } from "@vgen/db";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerGenerationQuotesRoute } from "./quotes";

const SIGNED_IN = { status: "authed" as const, user: { id: "11111111-1111-4111-8111-111111111111" } };
const QUOTE_ID = "33333333-3333-4333-8333-333333333333";

const quoted = (coins: number, unlimited?: { remainingToday: number | null; dailyCap: number | null }): QuoteResult => ({
  outcome: "quoted",
  quote: {
    id: QUOTE_ID,
    coins,
    expiresAt: 1_755_353_400_000,
    concurrency: { running: 0, limit: 4 },
    ...(unlimited ? { unlimited } : {}),
  },
});

function quotesApp(result: QuoteResult, identity: unknown = SIGNED_IN) {
  const create = vi.fn(async () => result);
  const app = Fastify({ logger: false });
  // The handler createApp installs, so a rejected body is the 400 the route
  // really answers rather than the 500 a bare Fastify would give.
  registerErrorHandling(app);
  registerGenerationQuotesRoute(app, { getCurrent: vi.fn(async () => identity) } as never, { create });
  return { app, create };
}

const body = { variantId: "nano-banana-pro", params: { resolution: "1K" } };
const post = (app: ReturnType<typeof quotesApp>["app"], payload: unknown) =>
  app.inject({ method: "POST", url: "/api/v1/generation/quotes", payload: payload as never });

/**
 * The seam between the contract and the repository.
 *
 * The integration tests prove what the *repository* does with the preference;
 * what they cannot see is whether the route ever hands it over. That gap is not
 * hypothetical — `referenceAssetIds` has been built by the browser and dropped
 * by an adapter since #55 for exactly this reason, with every layer either side
 * of the gap tested and passing.
 */
describe("asking for a price", () => {
  it("passes the preference through to the repository", async () => {
    const { app, create } = quotesApp(quoted(4));

    const response = await post(app, { ...body, preferUnlimited: false });

    expect(response.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ preferUnlimited: false }));
  });

  /**
   * Absent has to arrive as absent, not as false.
   *
   * The repository reads `?? true`, so a route that helpfully filled in a
   * `false` here would start charging every client written before the switch
   * existed — and the repository's own default would never get a chance to run.
   * Asserting `undefined` rather than "not called with true" is deliberate: it
   * pins which layer owns the default.
   */
  it("leaves the default to the repository when the request says nothing", async () => {
    const { app, create } = quotesApp(quoted(0, { remainingToday: 49, dailyCap: 50 }));

    const response = await post(app, body);

    expect(response.statusCode).toBe(200);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ preferUnlimited: undefined }));
  });

  it("returns the grant block the repository reports", async () => {
    const { app } = quotesApp(quoted(0, { remainingToday: 49, dailyCap: 50 }));

    const response = await post(app, { ...body, preferUnlimited: true });

    expect(response.json()).toMatchObject({ coins: 0, unlimited: { remainingToday: 49, dailyCap: 50 } });
  });

  /**
   * The schema is `.strict()` and has to stay that way. A request that could
   * name its own price is a request that could ask to be billed as something
   * cheaper, and the quiet version of that is a field nobody notices being
   * ignored.
   */
  it("refuses a field the contract does not name", async () => {
    const { app, create } = quotesApp(quoted(4));

    const response = await post(app, { ...body, coins: 0 });

    expect(response.statusCode).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a stranger before it touches the database", async () => {
    const { app, create } = quotesApp(quoted(4), { status: "anonymous" });

    const response = await post(app, body);

    expect(response.statusCode).toBe(401);
    expect(create).not.toHaveBeenCalled();
  });
});
