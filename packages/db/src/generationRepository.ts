import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { microCreditsToCoins } from "@vgen/core";
import { isBannedFromGenerating } from "./bansRepository";
import { PostgresEntitlementsRepository } from "./entitlementsRepository";
import { atomically } from "./transaction";

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
  | {
      outcome:
        | "quote_unavailable"
        | "quote_expired"
        | "quote_spent"
        | "params_mismatch"
        | "insufficient_credits"
        | "idempotency_conflict"
        /** The account already has as many generations running as its plan allows. */
        | "concurrency_reached"
        /** Free when quoted, but the daily allowance ran out in between. */
        | "allowance_spent"
        /** A `generation` or `platform` ban is in force on this account. */
        | "banned";
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
 * Turning a quote into a job, which is the moment everything else becomes real.
 *
 * The quote decided *what this costs*; this decides *whether it runs*, and it
 * is the only place the two halves of paying meet. Every refusal below exists
 * because it was reachable: a stale quote, a quote belonging to somebody else,
 * a cheap quote submitted with expensive settings, an account already at its
 * limit, an allowance that ran out in the seconds between quoting and
 * pressing the button.
 *
 * One transaction, and that is the design rather than tidiness. The hold and
 * the job row and the outbox event either all exist or none do — a job with no
 * hold generates for free, a hold with no job is money taken for nothing, and
 * a job with no outbox row sits queued forever.
 */

/**
 * What a job looks like to its owner.
 *
 * `modelKey` is the catalogue variant id, read out of capabilities rather than
 * `external_model_id` — the customer picked "nano-banana-pro", and which
 * provider string served it is ours to know and theirs not to care about.
 */
const SELECT_JOB = `
  select job.id, job.status, job.micro_credits_held, job.created_at,
         model.capabilities -> 'variant' ->> 'id' as model_key, job.quote_id
  from jobs job
  left join provider_models model on model.id = job.provider_model_id
`;

interface JobRow {
  id: string;
  status: GenerationJobStatus;
  micro_credits_held: string;
  created_at: Date;
  model_key: string | null;
  quote_id: string | null;
}

function toJob(row: JobRow): QueuedGenerationJob {
  return {
    id: row.id,
    status: row.status,
    modelKey: row.model_key ?? "unknown",
    quotedCredits: microCreditsToCoins(Number(row.micro_credits_held)),
    createdAt: row.created_at.getTime(),
  };
}

/** Thrown to unwind the transaction with an outcome rather than an error. */
class SubmissionRefused extends Error {
  constructor(readonly outcome: Exclude<CreateQueuedJobResult["outcome"], "created" | "replayed">) {
    super(outcome);
    this.name = "SubmissionRefused";
  }
}

/** postgres.js surfaces the SQLSTATE hold_credits raises on an empty balance. */
function isInsufficientCredits(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23514" &&
    String((error as { message?: string }).message ?? "").includes("insufficient_credits")
  );
}

interface QuoteRow {
  id: string;
  account_id: string;
  params_hash: Buffer;
  provider_model_id: string;
  feature_id: string;
  price_id: string | null;
  entitlement_id: string | null;
  sell_price_micro_credits: string;
  expired: boolean;
  spent: boolean;
}

export class PostgresGenerationRepository {
  constructor(private readonly sql: Sql) {}

  async createQueued(input: CreateQueuedJobInput): Promise<CreateQueuedJobResult> {
    const entitlements = new PostgresEntitlementsRepository(this.sql);

    try {
      // `atomically` rather than `begin`: postgres.js puts `begin` on a
      // connection and `savepoint` on an open transaction, so hardcoding
      // either would throw in one of the two places this is called from.
      return await atomically(this.sql)(async (tx) => {
        const [user] = await tx<{ personal_account_id: string | null }[]>`
          select personal_account_id from users where id = ${input.userId} limit 1
        `;
        const accountId = user?.personal_account_id;
        if (!accountId) throw new SubmissionRefused("quote_unavailable");

        // One submission per account at a time, and everything below depends on
        // it. Without this line all three of the following are wrong, and every
        // one of them was reproduced before it was fixed
        // (generationConcurrency.integration.test.ts):
        //
        //  - the replay check reads `jobs` and finds nothing, because the other
        //    transaction's row is inserted and not yet committed. Both insert,
        //    and the loser dies on `jobs_account_id_idempotency_key_idx` — a
        //    500 for the one thing an idempotency key exists to make safe.
        //  - the quote's `spent` subquery says false for the same reason. The
        //    `for update` below does not help: nothing UPDATEs the quote row, so
        //    the second reader is not re-evaluated after the first commits. Both
        //    insert, and the loser dies on `jobs_quote_idx`.
        //  - `concurrencyForTx` counts running jobs and takes no lock, so two
        //    submissions on different quotes both read `running = 0` and both
        //    pass a limit of one.
        //
        // All three are the same bug: a decision made from a count another
        // uncommitted transaction is about to invalidate. Serialising per
        // account fixes them together, because each of the three re-reads on a
        // fresh statement snapshot once the lock is released.
        //
        // FOR NO KEY UPDATE rather than FOR UPDATE: it conflicts with itself,
        // which is all that is wanted here, and unlike FOR UPDATE it does not
        // conflict with the FOR KEY SHARE that every insert referencing this
        // account takes. FOR UPDATE would make a submission block an unrelated
        // asset or order for the same customer for as long as it ran.
        //
        // Only same-account submissions serialise. Different accounts never
        // touch this row, so the throughput this costs is exactly the
        // throughput the per-account limit was always meant to deny.
        const [locked] = await tx<{ id: string }[]>`
          select id from accounts where id = ${accountId} for no key update
        `;
        if (!locked) throw new SubmissionRefused("quote_unavailable");

        // Inside the transaction, on the connection that is about to hold the
        // credits. Checking before `atomically` would leave a gap for a ban to
        // land in between deciding and charging — small, but the whole reason
        // an admin presses that button is that the account is costing money
        // right now.
        //
        // Before the replay check on purpose: a banned account must not be able
        // to retry its way into a job either.
        if (await isBannedFromGenerating(tx as unknown as Sql, input.userId)) throw new SubmissionRefused("banned");

        // Replay first, before anything is locked or spent. A client that
        // retried a request whose response it never saw must get the original
        // job back, not a second charge for the same picture.
        const [existing] = await tx<JobRow[]>`
          ${tx.unsafe(SELECT_JOB)}
          where job.account_id = ${accountId} and job.idempotency_key = ${input.idempotencyKey}
          limit 1
        `;
        if (existing) {
          // Same key, different request. Answering with the first job would be
          // a lie about what was submitted, so this is a conflict rather than
          // a replay.
          if (existing.quote_id !== input.quoteId) throw new SubmissionRefused("idempotency_conflict");
          return { outcome: "replayed" as const, job: toJob(existing) };
        }

        // FOR UPDATE serialises two submissions racing on one quote; the
        // `spent` subquery is what the second one loses on.
        const [quote] = await tx<QuoteRow[]>`
          select q.id, q.account_id, q.params_hash, q.provider_model_id, q.feature_id,
                 q.price_id, q.entitlement_id, q.sell_price_micro_credits,
                 q.expires_at <= now() as expired,
                 exists(select 1 from jobs j where j.quote_id = q.id) as spent
          from quotes q
          where q.id = ${input.quoteId}
          for update
        `;
        // A quote belonging to somebody else is reported as missing rather than
        // as forbidden: whether a given id exists is not this caller's business.
        if (!quote || quote.account_id !== accountId) throw new SubmissionRefused("quote_unavailable");
        if (quote.spent) throw new SubmissionRefused("quote_spent");
        if (quote.expired) throw new SubmissionRefused("quote_expired");

        // The whole reason the quote stores a hash. Timing-safe is unnecessary
        // — both sides are already public to this caller — but equality must be
        // over bytes, not over a string that could compare loosely.
        const submitted = Buffer.from(hashGenerationParams(input.params));
        if (!submitted.equals(quote.params_hash)) throw new SubmissionRefused("params_mismatch");

        const { limit, running } = await entitlements.concurrencyForTx(tx, accountId);
        if (running >= limit) throw new SubmissionRefused("concurrency_reached");

        const microCredits = Number(quote.sell_price_micro_credits);
        const [job] = await tx<{ id: string }[]>`
          insert into jobs (
            account_id, created_by, feature_id, provider_model_id, quote_id,
            price_id, entitlement_id, params, status, origin,
            idempotency_key, micro_credits_held
          ) values (
            ${accountId}, ${input.userId}, ${quote.feature_id}, ${quote.provider_model_id}, ${quote.id},
            ${quote.price_id}, ${quote.entitlement_id}, ${tx.json(input.params)}, 'queued', 'web',
            ${input.idempotencyKey}, ${microCredits}
          )
          returning id
        `;
        if (!job) throw new Error("job insert returned no row");

        if (quote.entitlement_id) {
          // Granted: take one from today's allowance instead of charging. The
          // claim is inside this transaction, so a failure anywhere below gives
          // the allowance back by rolling back rather than by remembering to.
          const claimed = await entitlements.claim(tx, quote.entitlement_id, accountId);
          if (claimed === null) throw new SubmissionRefused("allowance_spent");
        } else if (microCredits > 0) {
          // Held, not charged. What the generation actually costs is only known
          // once it has run, and a failure must give all of it back.
          await tx`select hold_credits(${accountId}, ${microCredits}, 'job', ${job.id}::uuid)`;
        }

        // Same transaction as the job, which is the entire point of an outbox:
        // a job that exists and was never announced is a job nothing will run.
        await tx`
          insert into outbox (topic, payload)
          values ('generation.requested', ${tx.json({ jobId: job.id, accountId, providerModelId: quote.provider_model_id })})
        `;

        const [created] = await tx<JobRow[]>`${tx.unsafe(SELECT_JOB)} where job.id = ${job.id}`;
        return { outcome: "created" as const, job: toJob(created!) };
      });
    } catch (error) {
      if (error instanceof SubmissionRefused) return { outcome: error.outcome };
      if (isInsufficientCredits(error)) return { outcome: "insufficient_credits" };
      throw error;
    }
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
