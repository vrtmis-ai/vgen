import { applyParamOverrides } from "@vgen/core";
import { ProviderTransportError, type GenerationProvider, type ProviderOptions } from "@vgen/adapters";
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

export async function runGeneration(jobId: string, deps: RunGenerationDeps): Promise<RunGenerationResult> {
  const { runner, secrets, isFinalAttempt } = deps;
  const sleep = deps.sleep ?? defaultSleep;
  const now = deps.now ?? Date.now;
  const pollTimeoutMs = deps.pollTimeoutMs ?? 10 * 60_000;
  const log = deps.log ?? (() => {});

  const job = await runner.claim(jobId);
  if (!job) return { outcome: "skipped", jobId };

  /**
   * Settle, or ask for another go.
   *
   * A retryable failure with attempts left leaves the job `running` and the
   * hold intact on purpose: the next delivery re-claims the same row and tries
   * the same generation, and re-releasing a hold each time would turn one
   * customer's credits into a stream of ledger noise.
   */
  const settle = async (errorCode: string, errorMessage: string, retryable: boolean): Promise<RunGenerationResult> => {
    if (retryable && !isFinalAttempt) {
      log({ event: "generation.retry", jobId, errorCode, errorMessage });
      return { outcome: "retry", jobId, reason: errorMessage };
    }
    await runner.fail(jobId, errorCode, errorMessage);
    log({ event: "generation.failed", jobId, errorCode, errorMessage });
    return { outcome: "failed", jobId, errorCode };
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
    return settle("provider_unavailable", `This model's provider (${job.providerCode}) is not connected yet.`, false);
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
    return settle("credential_unavailable", `This model's provider is not configured (${detail}).`, false);
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
  const params = applyParamOverrides(job.params, job.paramOverrides);

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
      return settle("no_output", "The provider reported success but returned no files.", false);
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
