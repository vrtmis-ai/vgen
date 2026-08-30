import { applyParamOverrides } from "@vgen/core";
import { ProviderTransportError, type GenerationProvider, type JsonObject, type ProviderOptions } from "@vgen/adapters";
import type { AttemptRecord, ClaimedJob, JobOutput, PooledCredential, SucceedInput } from "@vgen/db";
import type { OutputMirrorPort } from "./outputMirror";

/**
 * One job, from the queue to a settled balance.
 *
 * This is the only place that decides whether a customer keeps their money, so
 * it is written as a single readable path rather than as a class with the
 * decision spread across methods. Every exit below either captures the hold
 * because a picture exists, or releases it because one does not — there is no
 * third exit, and that is the property worth checking when changing this file.
 *
 * Ports rather than concrete types throughout: the tests run the whole path
 * against a fake provider precisely because the interesting cases — a provider
 * refusing, a socket dying halfway, a task that never finishes — are cases a
 * real provider cannot be asked to produce on demand.
 */

export interface JobRunnerPort {
  claim(jobId: string): Promise<ClaimedJob | null>;
  /** Storage keys for this account's reference uploads, by asset id. */
  referenceKeys(accountId: string, assetIds: string[]): Promise<Record<string, string>>;
  pickCredential(providerId: string): Promise<PooledCredential | null>;
  recordAttempt(record: AttemptRecord): Promise<string>;
  succeed(input: SucceedInput): Promise<void>;
  fail(jobId: string, errorCode: string, errorMessage: string): Promise<void>;
}

export interface RunGenerationDeps {
  runner: JobRunnerPort;
  createProvider(code: string, options: ProviderOptions): GenerationProvider | null;
  /**
   * Keeps a copy of each result before the provider's link to it expires.
   * Without this the gallery slowly empties itself and the customer is left
   * holding a receipt for a file nobody has.
   */
  mirror: OutputMirrorPort;
  /** Where secret_ref names are resolved. process.env in production. */
  secrets: Record<string, string | undefined>;
  /**
   * Turns a stored object key into something the provider can fetch.
   *
   * Signed here rather than when the job was submitted, because a signature
   * expires and a job can sit in a queue for as long as the queue is deep. A
   * URL minted at submission is a URL that may already be dead by the time
   * anybody uses it.
   */
  signReference(key: string): Promise<string>;
  /**
   * Whether BullMQ has any retries left. On the last one a retryable failure
   * has to be settled rather than re-thrown, or the hold outlives the queue.
   */
  isFinalAttempt: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** How long to wait for a provider task before giving up on it. */
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  log?: (event: Record<string, unknown>) => void;
}

/**
 * Puts the customer's uploaded references into the provider payload.
 *
 * The slot key is the upstream parameter name — `image_urls`,
 * `first_frame_url` — so a resolved slot is written straight onto `params`
 * under its own key and no per-provider mapping table has to be kept in step
 * with the catalogue.
 *
 * **A reference that cannot be resolved fails the job rather than being
 * dropped.** That is the whole point of this function existing. A first-frame
 * model handed no first frame does not error, it cheerfully makes something
 * else and charges for it, and the customer is left holding a picture they did
 * not ask for and a receipt they cannot argue with. Failing gives the money
 * back, which is the only honest outcome when we cannot do what was paid for.
 *
 * `max` decides string versus array, read from the catalogue's own slot
 * declaration rather than guessed from whether the key ends in an "s".
 */
export function attachReferences(
  params: JsonObject,
  slots: Record<string, string[]>,
  urlsById: Record<string, string>,
  refSlots: { key: string; max: number }[] | null,
): JsonObject {
  const maxFor = new Map((refSlots ?? []).map((slot) => [slot.key, slot.max]));
  const merged: JsonObject = { ...params };

  for (const [slot, ids] of Object.entries(slots)) {
    if (ids.length === 0) continue;
    const urls = ids.map((id) => {
      const url = urlsById[id];
      if (!url) throw new MissingReferenceError(slot);
      return url;
    });
    // An undeclared slot is treated as taking many. It should not happen — the
    // quote checked the ids and the catalogue declared the slots — but sending
    // an array where one was wanted is a provider error, while silently
    // dropping the file is a wrong picture nobody notices.
    //
    // `urls[0]!` is safe because the empty case returned above; the assertion
    // is there because the compiler cannot see that and `undefined` in a
    // provider payload is exactly the silent drop this function exists to stop.
    merged[slot] = (maxFor.get(slot) ?? 2) === 1 ? urls[0]! : urls;
  }
  return merged;
}

export class MissingReferenceError extends Error {
  constructor(readonly slot: string) {
    super(`a reference for "${slot}" is no longer available`);
    this.name = "MissingReferenceError";
  }
}

export type RunGenerationResult =
  | { outcome: "succeeded"; jobId: string }
  | { outcome: "failed"; jobId: string; errorCode: string }
  /** Somebody else already finished it. A duplicate delivery, not a problem. */
  | { outcome: "skipped"; jobId: string }
  /** Nothing settled: the caller must throw so the queue redelivers. */
  | { outcome: "retry"; jobId: string; reason: string };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Every error code a customer may be told, and the only wording each may carry.
 *
 * **The keys are the allow-list.** A code that is not here becomes
 * `provider_failed`, which is what keeps a provider's own vocabulary — KIE
 * returns its `failCode` verbatim — from reaching `jobs.error_code` and out
 * through the API.
 *
 * The wording is English and deliberately vague about *why*. Nothing renders
 * it: the client picks a Persian message from `src/features/generation/
 * validation.ts` keyed by the code, and these are what an API consumer or a log
 * reader sees. Every one of them is a refund — the worker either captures the
 * hold because a file exists or releases it because one does not — so none of
 * them needs to explain itself to justify a charge.
 *
 * Adding a code here is the deliberate act of deciding a customer may see it.
 * The real reason always survives, in the log line and on `job_attempts`, both
 * of which are behind the admin guard.
 */
const PUBLIC_FAILURE: Record<string, string> = {
  provider_unavailable: "This model cannot be run right now.",
  credential_unavailable: "This model cannot be run right now.",
  submit_failed: "This generation was not accepted.",
  poll_failed: "This generation stopped reporting progress.",
  provider_timeout: "This generation did not finish in time.",
  provider_cancelled: "This generation was cancelled before it finished.",
  provider_failed: "This generation could not be completed.",
  // Actionable, and it names nobody: the person can rephrase and try again.
  // Telling them "could not be completed" would withhold the one thing that
  // would have helped, so this earns its place on the list.
  content_policy: "This prompt was refused.",
  no_output: "This generation produced no files.",
  storage_failed: "The generation finished but could not be saved.",
  // Actionable and it names nobody: the file can be attached again. This is
  // reached when an upload was deleted between the quote and the queue, which
  // is rare and entirely the customer's own doing.
  reference_unavailable: "A file attached to this generation is no longer available.",
};

export async function runGeneration(jobId: string, deps: RunGenerationDeps): Promise<RunGenerationResult> {
  const { runner, secrets, isFinalAttempt, signReference } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const pollTimeoutMs = deps.pollTimeoutMs ?? 10 * 60_000;
  const log = deps.log ?? (() => {});

  const job = await runner.claim(jobId);
  if (!job) return { outcome: "skipped", jobId };

  /**
   * Settle, or ask for another go — telling the customer only what is theirs
   * to know.
   *
   * A retryable failure with attempts left leaves the job `running` and the
   * hold intact on purpose: the next delivery re-claims the same row and tries
   * the same generation, and re-releasing a hold each time would turn one
   * customer's credits into a stream of ledger noise.
   *
   * `detail` is the real reason and it stays here: it goes to the log and to
   * `recordAttempt`, both of which are ours. What reaches `jobs.error_message`
   * — and from there straight out of `GET /generation/jobs/:id` — is a fixed
   * string chosen by code.
   *
   * This is not cosmetic. The detail on this path has said
   * `WAVESPEED_API_KEY is not set`, `This model's provider (useapi) is not
   * connected yet`, and, verbatim from upstream, `Insufficient credits. Please
   * top up your account to continue.` — which names the company, our secret
   * naming convention, and the fact that we are a reseller, to anyone who opens
   * the network tab. The screen never rendered any of it (the client picks a
   * message by code), so the leak was invisible while being completely public.
   *
   * The code is normalised too, and for the same reason plus one more: KIE
   * returns its own `failCode` string, which would both leak and miss the
   * client's lookup table, so every job failed by KIE showed the generic
   * fallback message rather than the specific one.
   */
  const settle = async (errorCode: string, detail: string, retryable: boolean): Promise<RunGenerationResult> => {
    if (retryable && !isFinalAttempt) {
      log({ event: "generation.retry", jobId, errorCode, detail });
      return { outcome: "retry", jobId, reason: detail };
    }
    const code = PUBLIC_FAILURE[errorCode] ? errorCode : "provider_failed";
    await runner.fail(jobId, code, PUBLIC_FAILURE[code]!);
    // The raw text is logged, never stored on the job. Correlate by jobId.
    log({ event: "generation.failed", jobId, errorCode, code, detail });
    return { outcome: "failed", jobId, errorCode: code };
  };

  const attempt = (record: Partial<AttemptRecord> & Pick<AttemptRecord, "status">): AttemptRecord => ({
    jobId: job.id,
    attemptNo: job.attemptNo,
    providerId: job.providerId,
    providerModelId: job.providerModelId,
    credentialId: null,
    ...record,
  });

  const provider = deps.createProvider(job.providerCode, { baseUrl: job.providerBaseUrl ?? undefined, modality: job.modality });
  if (!provider) {
    // Configuration, not weather. Retrying gets the same absence, so this is
    // settled immediately and the customer is refunded now rather than after
    // five exponential backoffs.
    await runner.recordAttempt(
      attempt({
        status: "failed",
        errorCode: "provider_unavailable",
        errorMessage: `No adapter for provider "${job.providerCode}"`,
        finished: true,
      }),
    );
    // The provider code is the detail, not the message. settle() keeps it here.
    return settle("provider_unavailable", `no adapter for provider "${job.providerCode}"`, false);
  }

  const credential = await runner.pickCredential(job.providerId);
  const apiKey = credential ? secrets[credential.secretRef]?.trim() : undefined;
  if (!credential || !apiKey) {
    const detail = credential ? `${credential.secretRef} is not set` : `no active credential for ${job.providerCode}`;
    await runner.recordAttempt(
      attempt({
        status: "failed",
        credentialId: credential?.id ?? null,
        errorCode: "credential_unavailable",
        errorMessage: detail,
        finished: true,
      }),
    );
    return settle("credential_unavailable", detail, false);
  }

  // ---------------------------------------------------------------- submit
  const submittedAt = now();
  // Translated to this provider's vocabulary immediately before the call and
  // nowhere else. `job.params` stays the settings the customer chose and the
  // ones the price was hashed from; what a route renames is a property of
  // where the job is being sent, not of what was asked for.
  //
  // Computed outside the try so the failure path can record it. A provider
  // rejecting our parameters is the likeliest failure once a route moves, and
  // "400 invalid parameter" with no record of what was sent is the one message
  // that cannot be acted on — especially here, where the route's overrides mean
  // what went out is not what the customer chose.
  const overridden = applyParamOverrides(job.params, job.paramOverrides);

  /* The customer's uploaded references, resolved and signed at the last
     possible moment.

     Ownership is re-checked inside `referenceKeys` even though these ids came
     off the job row. It costs a predicate and can only ever be redundant,
     which on the one path where being wrong hands one customer's private
     upload to another customer's generation is the right kind of redundant.

     A reference that has gone settles the job as a failure and refunds, rather
     than submitting without it. A first-frame model handed no first frame does
     not error — it makes something else and charges for it. */
  let params: JsonObject = overridden;
  const slots = job.referenceAssetIds ?? {};
  const referenceIds = [...new Set(Object.values(slots).flat())];
  if (referenceIds.length > 0) {
    try {
      const keys = await runner.referenceKeys(job.accountId, referenceIds);
      const urls: Record<string, string> = {};
      for (const [id, key] of Object.entries(keys)) urls[id] = await signReference(key);
      params = attachReferences(overridden, slots, urls, job.refSlots);
    } catch (error) {
      const detail = error instanceof MissingReferenceError ? error.message : messageOf(error);
      // Not retryable: a deleted upload does not come back, and neither does a
      // storage layer that cannot sign for it in a way another attempt fixes.
      return settle("reference_unavailable", detail, false);
    }
  }

  let submission;
  try {
    submission = await provider.submit({ externalModelId: job.externalModelId, params, apiKey });
  } catch (error) {
    const retryable = error instanceof ProviderTransportError ? error.retryable : true;
    await runner.recordAttempt(
      attempt({
        status: "failed",
        credentialId: credential.id,
        requestPayload: params,
        errorCode: "submit_failed",
        errorMessage: messageOf(error),
        latencyMs: now() - submittedAt,
        finished: true,
      }),
    );
    return settle("submit_failed", messageOf(error), retryable);
  }

  await runner.recordAttempt(
    attempt({
      status: "polling",
      credentialId: credential.id,
      externalJobId: submission.externalJobId,
      endpoint: submission.endpoint,
      requestPayload: submission.requestPayload,
      responsePayload: submission.responsePayload,
      httpStatus: submission.httpStatus,
      latencyMs: now() - submittedAt,
    }),
  );
  log({
    event: "generation.submitted",
    jobId,
    provider: job.providerCode,
    externalJobId: submission.externalJobId,
    credential: credential.label,
  });

  // ---------------------------------------------------------------- poll
  const deadline = now() + pollTimeoutMs;
  let interval = deps.pollIntervalMs ?? 2_000;
  // A blip mid-poll is not a failed generation. Several in a row is.
  let consecutiveTransportErrors = 0;

  while (now() < deadline) {
    await sleep(interval);
    interval = Math.min(Math.round(interval * 1.3), 15_000);

    let outcome;
    try {
      outcome = await provider.poll(submission.externalJobId, apiKey);
      consecutiveTransportErrors = 0;
    } catch (error) {
      if (++consecutiveTransportErrors < 5) continue;
      await runner.recordAttempt(
        attempt({
          status: "failed",
          credentialId: credential.id,
          externalJobId: submission.externalJobId,
          errorCode: "poll_failed",
          errorMessage: messageOf(error),
          latencyMs: now() - submittedAt,
          finished: true,
        }),
      );
      return settle("poll_failed", messageOf(error), true);
    }

    if (outcome.state === "running") continue;

    if (outcome.state === "failed") {
      await runner.recordAttempt(
        attempt({
          status: "failed",
          credentialId: credential.id,
          externalJobId: submission.externalJobId,
          responsePayload: outcome.responsePayload,
          errorCode: outcome.errorCode,
          errorMessage: outcome.errorMessage,
          latencyMs: now() - submittedAt,
          finished: true,
        }),
      );
      return settle(outcome.errorCode, outcome.errorMessage, outcome.retryable);
    }

    // A "success" with nothing behind it is a failure. Capturing the hold here
    // would charge somebody for an empty gallery.
    if (outcome.outputs.length === 0) {
      await runner.recordAttempt(
        attempt({
          status: "failed",
          credentialId: credential.id,
          externalJobId: submission.externalJobId,
          responsePayload: outcome.responsePayload,
          errorCode: "no_output",
          errorMessage: "The provider reported success but returned no files.",
          latencyMs: now() - submittedAt,
          finished: true,
        }),
      );
      return settle("no_output", "the provider reported success but returned no files", false);
    }

    // Ours before it is theirs. A provider URL is a loan of a few hours, so
    // nothing counts as delivered until the bytes are in our own store.
    let stored: JobOutput[];
    try {
      stored = await Promise.all(
        outcome.outputs.map((output, index) => deps.mirror.mirror(output, { accountId: job.accountId, jobId: job.id, index })),
      );
    } catch (error) {
      // Not retryable, and this is the one place that is a money decision
      // rather than a policy one: another delivery would re-enter at `submit`
      // and generate a second picture, paying the provider twice for one the
      // customer already has. So the job fails, they are refunded in full, and
      // we absorb the provider's charge for a result we could not keep.
      await runner.recordAttempt(
        attempt({
          status: "failed",
          credentialId: credential.id,
          externalJobId: submission.externalJobId,
          responsePayload: outcome.responsePayload,
          providerUnitsCost: outcome.providerUnitsCost,
          errorCode: "storage_failed",
          errorMessage: messageOf(error),
          latencyMs: now() - submittedAt,
          finished: true,
        }),
      );
      return settle("storage_failed", "The generation finished but could not be saved.", false);
    }

    // The rate comes from `provider_credit_rates` for the provider that
    // actually served this job, resolved in the same statement that claimed it.
    // It used to be a constant keyed by provider code, which was correct only
    // while there was one provider.
    const unitCostUsd = job.providerUnitCostUsd;
    await runner.recordAttempt(
      attempt({
        status: "succeeded",
        credentialId: credential.id,
        externalJobId: submission.externalJobId,
        responsePayload: outcome.responsePayload,
        providerUnitsCost: outcome.providerUnitsCost,
        latencyMs: now() - submittedAt,
        finished: true,
      }),
    );
    await runner.succeed({
      jobId: job.id,
      outputs: stored,
      providerUnitsCost: outcome.providerUnitsCost,
      // A provider that reports nothing (WaveSpeed reports no per-prediction
      // cost on any documented endpoint) would otherwise leave the margin
      // trail blank for every job it serves, so the quote's own estimate
      // stands in. `provider_units_cost` on the attempt stays null either way,
      // which keeps "they told us" and "we worked it out" distinguishable.
      providerCostUsd:
        outcome.providerUnitsCost !== null && unitCostUsd !== null ? outcome.providerUnitsCost * unitCostUsd : job.estimatedCostUsd,
    });
    log({ event: "generation.succeeded", jobId, outputs: outcome.outputs.length, providerUnits: outcome.providerUnitsCost });
    return { outcome: "succeeded", jobId: job.id };
  }

  // Terminal rather than retryable, and that is a money decision. The upstream
  // task may well still be running; submitting a second one would pay the
  // provider twice for one generation the customer already gave up on.
  await runner.recordAttempt(
    attempt({
      status: "timeout",
      credentialId: credential.id,
      externalJobId: submission.externalJobId,
      errorCode: "provider_timeout",
      errorMessage: `No result after ${Math.round(pollTimeoutMs / 1000)}s`,
      latencyMs: now() - submittedAt,
      finished: true,
    }),
  );
  return settle("provider_timeout", "The provider did not finish in time.", false);
}
