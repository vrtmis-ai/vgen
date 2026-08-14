import { createHash } from "node:crypto";
import type { Sql } from "postgres";

export type GenerationJsonValue =
  null | string | number | boolean | readonly GenerationJsonValue[] | { readonly [key: string]: GenerationJsonValue };
export type GenerationParams = Record<string, GenerationJsonValue>;

export interface CreateQueuedJobInput {
  userId: string;
  quoteId: string;
  params: GenerationParams;
  idempotencyKey: string;
}

/** Every state a job row can be in. Mirrors the jobs_status_check constraint. */
export type GenerationJobStatus = "draft" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

export interface QueuedGenerationJob {
  id: string;
  status: GenerationJobStatus;
  modelKey: string;
  quotedCredits: number;
  createdAt: number;
}

export type CreateQueuedJobResult =
  | { outcome: "created" | "replayed"; job: QueuedGenerationJob }
  | { outcome: "quote_unavailable" | "quote_expired" | "params_mismatch" | "insufficient_credits" | "idempotency_conflict" };

export class GenerationNotImplementedError extends Error {
  readonly code = "generation_not_implemented";

  constructor() {
    super("Generation submission is not wired to the deev-db job model yet.");
    this.name = "GenerationNotImplementedError";
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Generation parameters must contain finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  throw new Error("Generation parameters must be JSON serializable");
}

/**
 * Key-order-independent hash of a parameter set.
 *
 * A quote is bound to one of these, so a client cannot be quoted for a cheap
 * generation and then submit an expensive one. Canonical because two objects
 * that differ only in key order are the same request.
 */
export function hashGenerationParams(params: GenerationParams): Uint8Array {
  return createHash("sha256").update(canonicalJson(params)).digest();
}

/**
 * Submission is not ported yet, and this is a deliberate stop rather than an
 * oversight.
 *
 * The credit half of the old implementation is done and is better placed than
 * it was: its FIFO spend across grants is now `hold_credits()` in migration
 * 0010, alongside `capture_hold`, `release_hold` and `grant_credits`, where the
 * lot ordering, the ledger's running balance and the balance cache are updated
 * under one lock instead of by each caller. The smoke suite covers it.
 *
 * What is missing is the job row, and it does not translate. The deev-db `jobs`
 * table needs a NOT NULL `feature_id`, and the seeded features are
 * image_generate / image_edit / video_generate / image_to_video / chat — so a
 * catalogue entry of kind 'image' maps to two of them and kind 'audio' maps to
 * none. Picking between them is a routing decision about what the product
 * offers, not a mechanical rename. There is also no `job_events` table here;
 * deev-db records attempts in `job_attempts`, with different columns and a
 * different meaning.
 *
 * Guessing at both would produce job rows that look right, are attributed to
 * the wrong feature, and quietly corrupt every per-feature analytics view in
 * the schema. It waits for the generation work, which owns those decisions.
 *
 * Nothing reaches this today: `POST /api/v1/jobs` requires an authenticated
 * session, and no principal resolver returns one yet.
 */
export class PostgresGenerationRepository {
  constructor(private readonly sql: Sql) {}

  async createQueued(_input: CreateQueuedJobInput): Promise<CreateQueuedJobResult> {
    throw new GenerationNotImplementedError();
  }

  async getForUser(_jobId: string, _userId: string): Promise<QueuedGenerationJob | null> {
    throw new GenerationNotImplementedError();
  }

  /** Queue depth. Reads the outbox only, so it is unaffected by the above. */
  async countPendingDispatches(): Promise<number> {
    const [row] = await this.sql<{ count: string }[]>`
      select count(*)::text as count
      from outbox
      where topic = 'generation.requested' and processed_at is null and attempts < max_attempts
    `;
    return Number(row?.count ?? 0);
  }
}
