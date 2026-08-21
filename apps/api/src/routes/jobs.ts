import { CreateGenerationJobSchema, GenerationIdempotencyKeySchema } from "@vgen/contracts";
import type { CreateQueuedJobInput, CreateQueuedJobResult, GenerationParams } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { GenerationLibraryApplication } from "../generationLibrary";
import type { CustomerSessionApplication } from "./session";

export interface GenerationJobsApplication {
  createQueued(input: CreateQueuedJobInput): Promise<CreateQueuedJobResult>;
}

/**
 * Why a submission was refused, as a status code.
 *
 * 402 is the only one about money. The rest are all "the request cannot be
 * honoured as sent" — a stale quote, a full account, an allowance that ran out
 * — and a client can act on each differently, so they keep distinct codes even
 * though several share a 409.
 */
const REFUSAL_STATUS: Record<string, { status: number; message: string }> = {
  insufficient_credits: { status: 402, message: "Not enough credits to create this job." },
  quote_unavailable: { status: 404, message: "Quote is not available." },
  quote_expired: { status: 410, message: "That quote has expired. Ask for a new price." },
  quote_spent: { status: 409, message: "That quote has already been used." },
  params_mismatch: { status: 409, message: "These settings are not the ones that were quoted." },
  idempotency_conflict: { status: 409, message: "That idempotency key was used for a different request." },
  concurrency_reached: { status: 429, message: "You already have as many generations running as your plan allows." },
  allowance_spent: { status: 409, message: "Your free generations for today ran out. Ask for a new price." },
  // 403, not 402: nothing about this is fixable by paying, and a client that
  // offered to top up would be lying about what went wrong.
  banned: { status: 403, message: "This account cannot start new generations." },
};

export function registerGenerationJobsRoute(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  generationJobs: GenerationJobsApplication,
  library: GenerationLibraryApplication,
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

    if (result.outcome === "created" || result.outcome === "replayed") {
      // Read back rather than answering with what the insert returned. It is
      // one extra query for the guarantee that costs the most to lose: this
      // route, `GET /generation/jobs/:id` and a page of the gallery all speak
      // the one shape, so a client parses generations once.
      const job = await library.get(result.job.id, session.user.id);
      // The row was just written in this account's name, so a miss here is a
      // bug rather than a refusal — and answering with one of the refusal
      // messages would blame the customer for it.
      if (!job) throw new Error(`job ${result.job.id} vanished between being created and being read back`);
      return reply.code(202).send(job);
    }

    const refusal = REFUSAL_STATUS[result.outcome];
    return reply
      .code(refusal?.status ?? 409)
      .send({ error: { code: result.outcome, message: refusal?.message ?? "That job could not be created." } });
  });

  /**
   * One job's progress. Scoped to the caller — a job id is not a capability.
   *
   * 404 rather than 403 for somebody else's job: whether a given id exists is
   * not this caller's business, and a 403 would confirm it does.
   */
  app.get<{ Params: { jobId: string } }>("/api/v1/generation/jobs/:jobId", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const job = await library.get(request.params.jobId, session.user.id);
    if (!job) return reply.code(404).send({ error: { code: "job_not_found", message: "No such job." } });
    return reply.code(200).send(job);
  });
}
