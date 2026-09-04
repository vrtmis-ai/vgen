import type { ParamOverrides } from "@vgen/core";
import type { Sql } from "postgres";
import { PostgresEntitlementsRepository } from "./entitlementsRepository";
import type { GenerationParams } from "./generationRepository";
import { atomically } from "./transaction";

/**
 * The database half of running a job: claiming one, recording every call made
 * on its behalf, and settling the money when it stops.
 *
 * The invariant this file exists to hold is one sentence long — **a user must
 * never pay for a generation they did not get** — and it is why `fail()` does
 * three things in one transaction rather than three things in a row. Releasing
 * the hold, giving back the daily allowance and marking the job failed either
 * all happen or none do; a crash between any two of them is what leaves money
 * stranded in `held_micro_credits` with nothing to explain it.
 */

export type Modality = "image" | "video" | "audio" | "text";

export interface ClaimedJob {
  id: string;
  accountId: string;
  createdBy: string;
  params: GenerationParams;
  /** 1 for the first provider call, and the `attempt_no` of its job_attempts row. */
  attemptNo: number;
  providerId: string;
  providerCode: string;
  providerBaseUrl: string | null;
  /** The row that actually runs it — the serving model when this is granted. */
  providerModelId: string;
  externalModelId: string;
  modality: Modality;
  /**
   * How this serving row's parameter names differ from the catalogue row's.
   * Empty for a job running on its own provider, which is most of them.
   */
  paramOverrides: ParamOverrides;
  /**
   * What one of this provider's own units costs us, from `provider_credit_rates`
   * effective now. Null when no rate is on file — the margin trail then records
   * nothing rather than guessing with somebody else's rate.
   */
  providerUnitCostUsd: number | null;
  /**
   * What the quote expected this to cost us, in USD.
   *
   * The fallback for a provider that reports no per-prediction cost. Null once
   * the quote has been cleaned up, which is fine — by then the job has long
   * since settled.
   */
  estimatedCostUsd: number | null;
  /** Set when the generation is free under a grant rather than paid for. */
  entitlementId: string | null;
  /**
   * Uploaded files per reference slot, as `slot key -> ordered asset ids`.
   *
   * Ids rather than URLs, because a URL that was signed when the job was
   * submitted may well have expired by the time a queue gets to it. The runner
   * signs them at the moment it calls the provider.
   */
  referenceAssetIds: Record<string, string[]> | null;
  /**
   * The picked variant's reference slots, for `max` alone.
   *
   * A slot whose `max` is 1 takes a bare string upstream (`first_frame_url`);
   * one that takes several takes an array (`image_urls`). Guessing that from
   * whether the key ends in an "s" is the sort of rule that works for
   * seventeen of eighteen slots and silently fails a generation on the
   * eighteenth, so it is read from the catalogue that declares it.
   */
  refSlots: { key: string; max: number }[] | null;
  microCreditsHeld: number;
  /** Null when nothing was held: a granted job, or one quoted at zero. */
  holdId: string | null;
}

export interface PooledCredential {
  id: string;
  label: string;
  /** The name of the environment variable holding the token, never the token. */
  secretRef: string;
}

export interface AttemptRecord {
  jobId: string;
  attemptNo: number;
  providerId: string;
  providerModelId: string;
  credentialId: string | null;
  externalJobId?: string | null;
  endpoint?: string | null;
  requestPayload?: GenerationParams | null;
  responsePayload?: GenerationParams | null;
  httpStatus?: number | null;
  status: "sent" | "polling" | "succeeded" | "failed" | "timeout" | "cancelled";
  providerUnitsCost?: number | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  finished?: boolean;
}

/**
 * One finished file, already in our own storage.
 *
 * Not a provider URL any more. Those expire - often within hours - so a gallery
 * built on them is a gallery that empties itself, and the customer paid for a
 * file rather than for a link to somebody else's copy of it.
 */
export interface JobOutput {
  kind: Modality;
  mimeType: string;
  bucket: string;
  key: string;
  byteSize: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
}

export interface SucceedInput {
  jobId: string;
  outputs: JobOutput[];
  providerUnitsCost: number | null;
  providerCostUsd: number | null;
}

/** `assets.kind` has no 'text' — a text output is filed as a document. */
const ASSET_KIND: Record<Modality, string> = { image: "image", video: "video", audio: "audio", text: "document" };

interface ClaimRow {
  id: string;
  account_id: string;
  created_by: string;
  params: GenerationParams;
  attempt_no: number;
  provider_id: string;
  provider_code: string;
  base_url: string | null;
  provider_model_id: string;
  external_model_id: string;
  modality: Modality;
  entitlement_id: string | null;
  reference_asset_ids: Record<string, string[]> | null;
  ref_slots: { key: string; max: number }[] | null;
  micro_credits_held: string;
  hold_id: string | null;
  param_overrides: ParamOverrides;
  provider_unit_cost_usd: string | null;
  estimated_cost_usd_micros: string | null;
}

export class PostgresJobRunnerRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Take the job, or find out somebody else already finished it.
   *
   * `queued` or `running` rather than `queued` alone. A worker that dies
   * holding a claimed job leaves it `running`, and BullMQ redelivers that job
   * once its lock expires — if this only accepted `queued`, that redelivery
   * would find nothing to do and the row would sit `running` forever with the
   * customer's credits held against it.
   *
   * The mutex is BullMQ's lock, not this row: the queue guarantees one active
   * consumer per job id, and a stalled redelivery only happens after that lock
   * has lapsed. This statement's job is to advance the state and hand back
   * everything the runner needs, in one round trip.
   *
   * The `coalesce` on the model is where the catalogue stops and the plumbing
   * starts. `jobs.provider_model_id` is what the customer picked; the row that
   * actually runs it can be a different provider's entirely, and three things
   * get a say, in this order:
   *
   *   1. an unlimited grant, which named a serving account when it was sold
   *   2. an active `model_routes` row, which is an admin's standing preference
   *   3. otherwise the catalogue row runs itself, which is the common case
   *
   * The order is a money decision, not a style one. A grant is a promise about
   * a specific upstream account; letting a routing preference outrank it would
   * quietly bill us for generations that were sold as free.
   */
  async claim(jobId: string): Promise<ClaimedJob | null> {
    const [row] = await this.sql<ClaimRow[]>`
      with claimed as (
        update jobs
        set status = 'running',
            started_at = coalesce(started_at, now()),
            attempt_count = attempt_count + 1
        where id = ${jobId} and status in ('queued', 'running') and deleted_at is null
        returning *
      )
      select job.id, job.account_id, job.created_by, job.params, job.reference_asset_ids,
             job.attempt_count as attempt_no, job.entitlement_id, job.micro_credits_held,
             run.id as provider_model_id, run.external_model_id, run.modality,
             provider.id as provider_id, provider.code as provider_code, provider.base_url,
             hold.id as hold_id,
             coalesce(route.param_overrides, '{}'::jsonb) as param_overrides,
             coalesce(picked.capabilities -> 'variant' -> 'refs', 'null'::jsonb) as ref_slots,
             rate.provider_unit_cost_usd, quote.provider_cost_usd_micros as estimated_cost_usd_micros
      from claimed job
      -- The row the customer picked, for its reference-slot declarations. The
      -- serving row joined below may be a different provider's and carries no
      -- variant at all, so the slots have to come from here.
      left join provider_models picked on picked.id = job.provider_model_id
      left join unlimited_entitlements ent on ent.id = job.entitlement_id
      left join lateral (
        select r.serving_model_id, r.param_overrides
        from model_routes r
        join provider_models sm on sm.id = r.serving_model_id
        join providers sp on sp.id = sm.provider_id
        where r.catalog_model_id = job.provider_model_id
          -- A grant already named a serving row and the customer was promised
          -- it, so an admin's routing preference does not outrank it. Skipping
          -- the lookup entirely rather than losing the tie later also keeps
          -- the overrides honest: they describe the route's provider, and
          -- applying them to the grant's would rename params for the wrong API.
          and ent.serving_model_id is null
          -- A route to a deactivated model, or through a provider that has
          -- been switched off, is not a route. Falling back to the catalogue
          -- row is what makes deactivating a provider a safe thing to do.
          and r.is_active and sm.is_active and sp.is_active
        order by r.priority asc
        limit 1
      ) route on true
      join provider_models run on run.id = coalesce(ent.serving_model_id, route.serving_model_id, job.provider_model_id)
      join providers provider on provider.id = run.provider_id
      left join credit_holds hold
        on hold.ref_type = 'job' and hold.ref_id = job.id and hold.status = 'held'
      left join quotes quote on quote.id = job.quote_id
      -- Effective-dated, and read for the provider that actually serves the
      -- job rather than for the one the customer picked. This used to be a
      -- constant in the worker, which was correct only while there was one
      -- provider and silently wrong the moment there were two.
      left join lateral (
        select pcr.provider_unit_cost_usd
        from provider_credit_rates pcr
        where pcr.provider_id = provider.id
          and pcr.valid_from <= now()
          and (pcr.valid_to is null or pcr.valid_to > now())
        order by pcr.valid_from desc
        limit 1
      ) rate on true
    `;
    if (!row) return null;
    return {
      id: row.id,
      accountId: row.account_id,
      createdBy: row.created_by,
      params: row.params,
      referenceAssetIds: row.reference_asset_ids,
      refSlots: row.ref_slots,
      attemptNo: row.attempt_no,
      providerId: row.provider_id,
      providerCode: row.provider_code,
      providerBaseUrl: row.base_url,
      providerModelId: row.provider_model_id,
      externalModelId: row.external_model_id,
      modality: row.modality,
      entitlementId: row.entitlement_id,
      microCreditsHeld: Number(row.micro_credits_held),
      holdId: row.hold_id,
      paramOverrides: row.param_overrides,
      providerUnitCostUsd: row.provider_unit_cost_usd === null ? null : Number(row.provider_unit_cost_usd),
      estimatedCostUsd: row.estimated_cost_usd_micros === null ? null : Number(row.estimated_cost_usd_micros) / 1_000_000,
    };
  }

  /**
   * Where each reference asset actually lives, for the account that owns it.
   *
   * The account is passed and compared even though the ids came off the job
   * row, which the job's own account wrote. That is deliberate belt-and-braces
   * on the one path where getting it wrong hands one customer's private upload
   * to another customer's generation: a check that costs a predicate and can
   * only ever be redundant is the right kind of redundant.
   *
   * Returns storage keys rather than URLs. Signing belongs to whoever is about
   * to make the call, because a signature has an expiry and a job can sit in a
   * queue — a URL signed at submission is a URL that may already be dead.
   */
  async referenceKeys(accountId: string, assetIds: string[]): Promise<Record<string, string>> {
    if (assetIds.length === 0) return {};
    const rows = await this.sql<{ id: string; storage_key: string }[]>`
      select id, storage_key from assets
      where id = any(${assetIds}::uuid[])
        and account_id = ${accountId}
        -- Both origins, matching usableReferenceCount in quotesRepository:
        -- a finished generation is a legal input to the next one ("to video"),
        -- and the two predicates have to agree or a quote would price a
        -- reference the worker then refuses to sign for.
        and origin in ('upload', 'generated')
        and deleted_at is null
    `;
    return Object.fromEntries(rows.map((row) => [row.id, row.storage_key]));
  }

  /**
   * The least-recently-used active credential for a provider.
   *
   * Round-robin by `last_used_at`, stamped as part of the same statement so two
   * workers picking at the same instant cannot both take the same account. That
   * matters here more than it would for a single API key: the useapi pool is
   * three PixVerse subscriptions with roughly two concurrent creates each, so
   * an unfair picker does not mean a slightly uneven load, it means one account
   * answering 429 while two sit idle.
   *
   * `daily_request_cap` is deliberately not a filter. Past it the upstream
   * slows rather than fails, and a slow generation is still a generation — but
   * an account with headroom is preferred over one without, so the fast path
   * fills first.
   */
  async pickCredential(providerId: string): Promise<PooledCredential | null> {
    const [row] = await this.sql<{ id: string; label: string; secret_ref: string }[]>`
      update provider_credentials
      -- clock_timestamp, not now(): now() is the transaction's start time, so
      -- two picks inside one transaction would stamp the same instant and the
      -- round-robin would keep handing back the same account.
      set last_used_at = clock_timestamp()
      where id = (
        select cred.id
        from provider_credentials cred
        where cred.provider_id = ${providerId}
          and cred.is_active
          and (cred.expires_at is null or cred.expires_at > now())
        order by
          -- Accounts with room to run at full speed first, then the one idle
          -- longest, then weight as the tie-break the column was added for.
          (
            cred.daily_request_cap is not null
            and (
              select count(*) from job_attempts att
              where att.credential_id = cred.id
                and att.started_at >= (now() at time zone 'Asia/Tehran')::date at time zone 'Asia/Tehran'
            ) >= cred.daily_request_cap
          ) asc,
          cred.last_used_at asc nulls first,
          cred.weight desc,
          cred.id asc
        for update skip locked
        limit 1
      )
      returning id, label, secret_ref
    `;
    return row ? { id: row.id, label: row.label, secretRef: row.secret_ref } : null;
  }

  /** One row per provider call. The trail a charge is explained from. */
  async recordAttempt(record: AttemptRecord): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into job_attempts (
        job_id, attempt_no, provider_id, provider_model_id, credential_id,
        external_job_id, endpoint, request_payload, response_payload, http_status,
        status, provider_units_cost, latency_ms, error_code, error_message, finished_at
      ) values (
        ${record.jobId}, ${record.attemptNo}, ${record.providerId}, ${record.providerModelId}, ${record.credentialId},
        ${record.externalJobId ?? null}, ${record.endpoint ?? null},
        ${record.requestPayload ? this.sql.json(record.requestPayload) : null},
        ${record.responsePayload ? this.sql.json(record.responsePayload) : null},
        ${record.httpStatus ?? null},
        ${record.status}, ${record.providerUnitsCost ?? null}, ${record.latencyMs ?? null},
        ${record.errorCode ?? null}, ${(record.errorMessage ?? null)?.slice(0, 2_000) ?? null},
        ${record.finished ? this.sql`now()` : null}
      )
      on conflict (job_id, attempt_no) do update set
        external_job_id = coalesce(excluded.external_job_id, job_attempts.external_job_id),
        response_payload = coalesce(excluded.response_payload, job_attempts.response_payload),
        http_status = coalesce(excluded.http_status, job_attempts.http_status),
        status = excluded.status,
        provider_units_cost = coalesce(excluded.provider_units_cost, job_attempts.provider_units_cost),
        latency_ms = coalesce(excluded.latency_ms, job_attempts.latency_ms),
        error_code = coalesce(excluded.error_code, job_attempts.error_code),
        error_message = coalesce(excluded.error_message, job_attempts.error_message),
        finished_at = coalesce(excluded.finished_at, job_attempts.finished_at)
      returning id
    `;
    return row!.id;
  }

  /**
   * The generation landed: file the outputs and charge for it.
   *
   * The capture is the full hold, not a recomputation from what the provider
   * turned out to charge us. The customer was quoted a price and pressed a
   * button on that price; discovering afterwards that it was cheap for us is
   * our good luck, and discovering it was expensive is our bad luck. What the
   * provider actually cost is recorded beside it so the margin is measurable
   * rather than assumed.
   *
   * ponytail: partial capture is a one-argument change to capture_hold if a
   * per-second model ever needs settling against a real duration.
   *
   * The outputs are already in our own storage by the time this is called -
   * the runner mirrors them before settling, because a generation we cannot
   * keep is a generation the customer did not get.
   */
  async succeed(input: SucceedInput): Promise<void> {
    await atomically(this.sql)(async (transaction) => {
      const tx = transaction as unknown as Sql;
      const [job] = await tx<{ account_id: string; created_by: string; status: string; micro_credits_held: string }[]>`
        select account_id, created_by, status, micro_credits_held from jobs where id = ${input.jobId} for update
      `;
      // Already settled — a duplicate delivery, not an error. Charging again
      // would be the error.
      if (!job || job.status !== "running") return;

      for (const [index, output] of input.outputs.entries()) {
        await tx`
          insert into assets (
            account_id, created_by, kind, origin, job_id, output_index,
            storage_provider, storage_bucket, storage_key, mime_type,
            byte_size, sha256, width, height, duration_ms
          ) values (
            ${job.account_id}, ${job.created_by}, ${ASSET_KIND[output.kind]}, 'generated', ${input.jobId}, ${index},
            's3', ${output.bucket}, ${output.key}, ${output.mimeType},
            ${output.byteSize}, ${output.sha256}, ${output.width ?? null}, ${output.height ?? null}, ${output.durationMs ?? null}
          )
          -- A redelivered completion re-files the same object at the same key.
          -- Doing nothing is right: the row is already there and correct.
          on conflict (storage_bucket, storage_key) do nothing
        `;
      }

      const captured = Number(job.micro_credits_held);
      await tx`
        update jobs set
          status = 'succeeded',
          completed_at = now(),
          output_count = ${input.outputs.length},
          provider_units_cost = ${input.providerUnitsCost},
          provider_cost_usd = ${input.providerCostUsd},
          micro_credits_charged = ${captured},
          error_code = null,
          error_message = null
        where id = ${input.jobId}
      `;

      const [hold] = await tx<{ id: string }[]>`
        select id from credit_holds
        where ref_type = 'job' and ref_id = ${input.jobId} and status = 'held'
      `;
      if (hold) await tx`select capture_hold(${hold.id}, ${captured})`;
    });
  }

  /**
   * The generation did not land: give everything back.
   *
   * Both refunds are unconditional in the sense that matters — a paid job gets
   * its hold released, a granted job gets its slice of the day back, and a job
   * that is somehow both gets both. Neither is skipped because the other
   * applied.
   */
  async fail(jobId: string, errorCode: string, errorMessage: string): Promise<void> {
    await atomically(this.sql)(async (transaction) => {
      const tx = transaction as unknown as Sql;
      const [job] = await tx<{ account_id: string; status: string; entitlement_id: string | null }[]>`
        select account_id, status, entitlement_id from jobs where id = ${jobId} for update
      `;
      if (!job || (job.status !== "running" && job.status !== "queued")) return;

      const [hold] = await tx<{ id: string }[]>`
        select id from credit_holds
        where ref_type = 'job' and ref_id = ${jobId} and status = 'held'
      `;
      if (hold) await tx`select release_hold(${hold.id})`;

      if (job.entitlement_id) {
        await new PostgresEntitlementsRepository(tx).release(tx, job.entitlement_id, job.account_id);
      }

      await tx`
        update jobs set
          status = 'failed',
          completed_at = now(),
          micro_credits_charged = 0,
          error_code = ${errorCode.slice(0, 200)},
          error_message = ${errorMessage.slice(0, 2_000)}
        where id = ${jobId}
      `;
    });
  }
}
