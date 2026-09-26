import { CreateGenerationJobSchema, GenerationIdempotencyKeySchema } from "@vgen/contracts";
import type { CreateQueuedJobInput, CreateQueuedJobResult, GenerationParams } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { GenerationLibraryApplication } from "../generationLibrary";
import { track } from "../posthog";
import type { PromptGuardApplication } from "../promptGuard";
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
  promptGuard: PromptGuardApplication,
): void {
  app.post("/api/v1/jobs", { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const idempotencyKey = GenerationIdempotencyKeySchema.parse(request.headers["idempotency-key"]);
    const body = CreateGenerationJobSchema.parse(request.body);

    /* The gate that is actually load-bearing. The quote path checks the same
       prompt earlier and for kinder reasons, but a client can replay an old
       quote id or skip that call entirely — this is the one request that
       dispatches to a provider, so this is where the answer has to be final.

       Read from `params`, which is what the worker hands upstream verbatim,
       rather than from any field alongside it. Guarding a copy of the prompt
       while a different copy is what travels is the shape of bug that makes a
       filter look present and be absent. */
    const prompt = typeof body.params.prompt === "string" ? body.params.prompt : "";
    // Named apart from the `refusal` below, which is the submission-outcome
    // table. Two different refusals, and only one of them is about content.
    const contentRefusal = await promptGuard.check({ prompt, userId: session.user.id, surface: "job" });
    if (contentRefusal) {
      // The outcome only: which moderation category tripped is the prompt
      // guard's own record, not something to attach to a person in a third party.
      track(request, session.user.id, "generation_job_refused", { outcome: "prompt_refused" });
      return reply
        .code(422)
        .send({ error: { code: "prompt_refused", message: contentRefusal.message, category: contentRefusal.category } });
    }

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
      track(request, session.user.id, "generation_job_created", {
        family_id: job.familyId,
        variant_id: job.variantId,
        coins: job.coins,
        submission_outcome: result.outcome,
      });
      return reply.code(202).send(job);
    }

    track(request, session.user.id, "generation_job_refused", { outcome: result.outcome });
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

  /**
   * Save one output, rather than look at it.
   *
   * A redirect rather than a proxy: the bytes still come straight from the
   * object store, and the only thing this adds is the session check and a
   * signature that carries `Content-Disposition: attachment`. Streaming them
   * through Node instead would spend a request slot per megabyte to change one
   * header.
   *
   * It exists at all because the `download` attribute on an anchor is ignored
   * for cross-origin URLs, and every output URL is cross-origin — signed
   * against the store's host, never the app's. The button looked like it
   * worked and opened the picture in a tab.
   */
  app.get<{ Params: { jobId: string; index: string } }>(
    "/api/v1/generation/jobs/:jobId/outputs/:index/download",
    async (request, reply) => {
      const session = await sessions.getCurrent(request);
      if (session.status !== "authed") {
        return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
      }

      const index = Number(request.params.index);
      if (!Number.isInteger(index) || index < 0) {
        return reply.code(400).send({ error: { code: "invalid_index", message: "Output index must be a whole number." } });
      }

      const url = await library.downloadUrl(request.params.jobId, session.user.id, index);
      // Same 404 as above, for the same reason: whether an id exists is not
      // this caller's business.
      if (!url) return reply.code(404).send({ error: { code: "output_not_found", message: "No such output." } });
      // 302 rather than 301: the URL it points at is signed and expires within
      // the hour, and a permanent redirect is exactly the thing a browser is
      // entitled to remember.
      return reply.redirect(url, 302);
    },
  );

  /**
   * The files a generation was run against.
   *
   * What "generate again" needs and could not get: the job has stored its
   * references since 0028 and the worker has read them ever since, but nothing
   * served them back, so re-running a generation could carry the model and the
   * prompt and would silently drop the first frame — a different generation for
   * the same money.
   *
   * Scoped through the job, never by asset id. The caller names a generation
   * the ownership check already covers, and the ids come out of that row rather
   * than out of the request.
   */
  app.get<{ Params: { jobId: string } }>("/api/v1/generation/jobs/:jobId/references", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }
    // An empty list for a job that is not theirs, and for one that never had a
    // reference. Whether an id exists is not this caller's business, and the
    // two are indistinguishable to anyone who is not the owner.
    return reply.send({ references: await library.references(request.params.jobId, session.user.id) });
  });

  /**
   * Take one generation off the customer's wall.
   *
   * A soft delete — see `removeForUser`. The row stays as the accounting record
   * for money that already moved; it stops being part of the gallery.
   *
   * 409 rather than a silent success while the job is still going. A queued or
   * running generation has credits held against it, and hiding it would leave
   * the customer with coins missing from their balance and nothing on screen
   * that accounts for them. Stopping a queued generation is a different act
   * with a different effect on the money — `POST …/cancel`, below — and quietly
   * deleting the row would be neither.
   */
  app.delete<{ Params: { jobId: string } }>("/api/v1/generation/jobs/:jobId", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const outcome = await library.remove(request.params.jobId, session.user.id);
    // Same 404 as the reads above, for the same reason: whether an id exists is
    // not this caller's business.
    if (outcome === "not_found") return reply.code(404).send({ error: { code: "job_not_found", message: "No such job." } });
    if (outcome === "still_running") {
      return reply.code(409).send({ error: { code: "job_running", message: "That generation has not finished yet." } });
    }
    return reply.code(200).send({ outcome });
  });

  /**
   * Take back a generation that has not started, and its coins with it.
   *
   * `queued` only — see `cancelForUser`. Answers with the job in the same shape
   * as the GET above, so the screen can redraw from it, and answers the same
   * way to a second cancel so a double tap is not an error.
   */
  app.post<{ Params: { jobId: string } }>("/api/v1/generation/jobs/:jobId/cancel", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const outcome = await library.cancel(request.params.jobId, session.user.id);
    if (outcome === "not_found") return reply.code(404).send({ error: { code: "job_not_found", message: "No such job." } });
    if (outcome === "started") {
      return reply.code(409).send({ error: { code: "job_started", message: "That generation has already started." } });
    }
    if (outcome === "finished") {
      return reply.code(409).send({ error: { code: "job_finished", message: "That generation has already finished." } });
    }
    const job = await library.get(request.params.jobId, session.user.id);
    if (!job) return reply.code(404).send({ error: { code: "job_not_found", message: "No such job." } });
    return reply.code(200).send(job);
  });
}
