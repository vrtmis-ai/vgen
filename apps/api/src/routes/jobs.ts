import { CreateGenerationJobSchema, GenerationIdempotencyKeySchema } from "@vgen/contracts";
import type { CreateQueuedJobInput, CreateQueuedJobResult, GenerationParams } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { CustomerSessionApplication } from "./session";

export interface GenerationJobsApplication {
  createQueued(input: CreateQueuedJobInput): Promise<CreateQueuedJobResult>;
}

export function registerGenerationJobsRoute(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  generationJobs: GenerationJobsApplication,
): void {
  app.post("/api/v1/jobs", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const idempotencyKey = GenerationIdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const body = CreateGenerationJobSchema.parse(request.body);
    const result = await generationJobs.createQueued({
      userId: session.user.id,
      quoteId: body.quoteId,
      params: body.params as GenerationParams,
      idempotencyKey,
    });

    if (result.outcome === "created" || result.outcome === "replayed") return reply.code(202).send(result.job);
    if (result.outcome === "insufficient_credits") {
      return reply.code(402).send({ error: { code: result.outcome, message: "Not enough credits to create this job." } });
    }
    if (result.outcome === "quote_unavailable") {
      return reply.code(404).send({ error: { code: result.outcome, message: "Quote is not available." } });
    }
    return reply.code(409).send({ error: { code: result.outcome, message: "Job request conflicts with the quote or idempotency key." } });
  });
}
