import { GenerationQuoteSchema, QuoteGenerationRequestSchema } from "@vgen/contracts";
import type { GenerationParams, QuoteRequest, QuoteResult } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { CustomerSessionApplication } from "./session";

export interface GenerationQuotesApplication {
  create(request: QuoteRequest): Promise<QuoteResult>;
}

/**
 * The price of a generation, decided here rather than in the browser.
 *
 * Authenticated on purpose, unlike `GET /plans`: a price is per account. What
 * it costs depends on the plan's tier and on how much of today's unlimited
 * allowance is left, and neither question has an answer for a stranger.
 */
export function registerGenerationQuotesRoute(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  quotes: GenerationQuotesApplication,
): void {
  app.post("/api/v1/generation/quotes", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const body = QuoteGenerationRequestSchema.parse(request.body);
    const result = await quotes.create({
      userId: session.user.id,
      variantId: body.variantId,
      params: body.params as GenerationParams,
      prompt: body.prompt,
      clipSeconds: body.clipSeconds,
      preferUnlimited: body.preferUnlimited,
      referenceAssetIds: body.referenceAssetIds,
    });

    if (result.outcome === "quoted") return reply.code(200).send(GenerationQuoteSchema.parse(result.quote));

    if (result.outcome === "tier_too_low") {
      // 403 rather than 402: the account is not short of money, it is on the
      // wrong plan, and the fix is an upgrade rather than a top-up. The tiers
      // are in the body so the client can name the plan that would unlock it
      // without a second round trip.
      return reply.code(403).send({
        error: {
          code: result.outcome,
          message: "This model needs a higher plan.",
          requiredTier: result.requiredTier,
          currentTier: result.currentTier,
        },
      });
    }

    if (result.outcome === "unknown_variant" || result.outcome === "unknown_account") {
      return reply.code(404).send({ error: { code: result.outcome, message: "That model is not available." } });
    }

    // 404 rather than 403, and one message for "does not exist", "is somebody
    // else's" and "was deleted". Telling those apart would make this route an
    // oracle for whether a given asset id exists, which is precisely what a
    // uuid must not be worth.
    if (result.outcome === "unknown_reference") {
      return reply.code(404).send({ error: { code: result.outcome, message: "An attached file is not available." } });
    }

    // The variant exists but this combination of settings has no price — an
    // aspect ratio the provider does not sell, say. 409 rather than 404
    // because the thing being asked for exists and the request is what is wrong.
    return reply.code(409).send({ error: { code: result.outcome, message: "Those settings are not offered." } });
  });
}
