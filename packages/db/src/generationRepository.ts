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
export type GenerationJobStatus = "queued" | "submitted" | "running" | "succeeded" | "failed" | "cancelled" | "expired";

export interface QueuedGenerationJob {
  id: string;
  /**
   * The row's real status, not a literal.
   *
   * This was typed and returned as `"queued"` regardless of what the column
   * said, which is fine for a freshly inserted job and wrong for the other
   * caller: the idempotency replay path returns whatever row already exists. A
   * client retrying a create after its job had finished — an ordinary network
   * retry — got 202 with "queued" for a job that completed minutes earlier.
   */
  status: GenerationJobStatus;
  modelKey: string;
  quotedCredits: number;
  createdAt: number;
}

export type CreateQueuedJobResult =
  | { outcome: "created" | "replayed"; job: QueuedGenerationJob }
  | { outcome: "quote_unavailable" | "quote_expired" | "params_mismatch" | "insufficient_credits" | "idempotency_conflict" };

type JobRow = {
  id: string;
  quote_id: string;
  status: GenerationJobStatus;
  model_key: string;
  params_hash_hex: string;
  quoted_credits: string;
  created_at: Date;
};

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

export function hashGenerationParams(params: GenerationParams): Uint8Array {
  return createHash("sha256").update(canonicalJson(params)).digest();
}

function safeCredits(value: string): number {
  const credits = Number(value);
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("Generation credit amount is outside the safe integer range");
  return credits;
}

function publicJob(row: JobRow): QueuedGenerationJob {
  return {
    id: row.id,
    status: row.status,
    modelKey: row.model_key,
    quotedCredits: safeCredits(row.quoted_credits),
    createdAt: row.created_at.getTime(),
  };
}

export class PostgresGenerationRepository {
  constructor(private readonly sql: Sql) {}

  async createQueued(input: CreateQueuedJobInput): Promise<CreateQueuedJobResult> {
    const paramsHash = hashGenerationParams(input.params);
    const paramsHashHex = Buffer.from(paramsHash).toString("hex");

    return this.sql.begin(async (transaction) => {
      await transaction`select pg_advisory_xact_lock(hashtextextended(${`generation:${input.userId}:${input.idempotencyKey}`}, 0))`;

      const [replay] = await transaction<JobRow[]>`
        select id, quote_id, status, model_key, encode(params_hash, 'hex') as params_hash_hex,
               quoted_credits::text as quoted_credits, created_at
        from jobs
        where user_id = ${input.userId} and idempotency_key = ${input.idempotencyKey}
        limit 1
      `;
      if (replay) {
        if (replay.quote_id !== input.quoteId || replay.params_hash_hex !== paramsHashHex) return { outcome: "idempotency_conflict" };
        return { outcome: "replayed", job: publicJob(replay) };
      }

      const [quote] = await transaction<
        {
          catalog_version: number;
          model_key: string;
          params_hash_hex: string;
          sell_price_credits: string;
          expired: boolean;
        }[]
      >`
        select catalog_version, model_key, encode(params_hash, 'hex') as params_hash_hex,
               sell_price_credits::text as sell_price_credits, expires_at <= now() as expired
        from quotes
        where id = ${input.quoteId} and user_id = ${input.userId}
        for update
      `;
      if (!quote) return { outcome: "quote_unavailable" };
      if (quote.expired) return { outcome: "quote_expired" };
      if (quote.params_hash_hex !== paramsHashHex) return { outcome: "params_mismatch" };

      const [quoteJob] = await transaction<{ id: string }[]>`select id from jobs where quote_id = ${input.quoteId} limit 1`;
      if (quoteJob) return { outcome: "quote_unavailable" };

      const quotedCredits = safeCredits(quote.sell_price_credits);
      const grants = await transaction<{ id: string; amount: string; consumed: string }[]>`
        select id, amount::text as amount, consumed::text as consumed
        from credit_grants
        where user_id = ${input.userId}
          and consumed < amount
          and (expires_at is null or expires_at > now())
        order by expires_at asc nulls last, granted_at asc, id asc
        for update
      `;
      const available = grants.reduce(
        (sum, grant) => Math.min(quotedCredits, sum + safeCredits(grant.amount) - safeCredits(grant.consumed)),
        0,
      );
      if (available < quotedCredits) return { outcome: "insufficient_credits" };

      const [job] = await transaction<JobRow[]>`
        insert into jobs (
          user_id, quote_id, status, catalog_version, model_key, params, params_hash,
          idempotency_key, quoted_credits, held_credits
        ) values (
          ${input.userId}, ${input.quoteId}, 'queued', ${quote.catalog_version}, ${quote.model_key},
          ${transaction.json(input.params)}, ${paramsHash}, ${input.idempotencyKey}, ${quotedCredits}, ${quotedCredits}
        )
        returning id, quote_id, status, model_key, encode(params_hash, 'hex') as params_hash_hex,
                  quoted_credits::text as quoted_credits, created_at
      `;
      if (!job) throw new Error("Generation job insert returned no row");

      let remaining = quotedCredits;
      for (const grant of grants) {
        if (remaining === 0) break;
        const spendable = safeCredits(grant.amount) - safeCredits(grant.consumed);
        const allocation = Math.min(spendable, remaining);
        await transaction`update credit_grants set consumed = consumed + ${allocation} where id = ${grant.id}`;
        await transaction`
          insert into credit_ledger (
            user_id, grant_id, delta, reason, ref_type, ref_id, idempotency_key, actor_type, actor_id
          ) values (
            ${input.userId}, ${grant.id}, ${-allocation}, 'job_hold', 'job', ${job.id},
            ${`job:${job.id}:hold:${grant.id}`}, 'user', ${input.userId}
          )
        `;
        remaining -= allocation;
      }

      await transaction`
        insert into job_events (job_id, from_status, to_status, source, payload)
        values (${job.id}, null, 'queued', 'api', ${transaction.json({ quoteId: input.quoteId })})
      `;
      await transaction`
        insert into outbox (aggregate, aggregate_id, event_type, payload)
        values ('job', ${job.id}, 'generation.requested', ${transaction.json({ jobId: job.id })})
      `;

      return { outcome: "created", job: publicJob(job) };
    }) as Promise<CreateQueuedJobResult>;
  }

  async getForUser(jobId: string, userId: string): Promise<QueuedGenerationJob | null> {
    const [row] = await this.sql<JobRow[]>`
      select id, quote_id, status, model_key, encode(params_hash, 'hex') as params_hash_hex,
             quoted_credits::text as quoted_credits, created_at
      from jobs
      -- No status filter. This read is how a caller asks "what happened to my
      -- job", and restricting it to 'queued' made the answer null for every job
      -- that had actually progressed — the states a poller most needs.
      where id = ${jobId} and user_id = ${userId}
      limit 1
    `;
    return row ? publicJob(row) : null;
  }

  async countPendingDispatches(): Promise<number> {
    const [row] = await this.sql<{ count: string }[]>`
      select count(*)::text as count
      from outbox
      where event_type = 'generation.requested' and published_at is null and dead_lettered_at is null
    `;
    return Number(row?.count ?? 0);
  }
}
