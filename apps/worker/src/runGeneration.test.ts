import { describe, expect, it } from "vitest";
import { ProviderTransportError, type GenerationOutcome, type GenerationProvider } from "@vgen/adapters";
import type { AttemptRecord, ClaimedJob, SucceedInput } from "@vgen/db";
import { runGeneration, type JobRunnerPort } from "./runGeneration";
import type { OutputMirrorPort } from "./outputMirror";

/**
 * The whole lifecycle against a provider that can be told to misbehave.
 *
 * The cases worth testing are the ones a real provider cannot be asked for:
 * refusing a prompt, dying mid-poll, reporting success with nothing attached.
 * Each one is here because it decides whether somebody gets charged.
 */

const JOB_ID = "11111111-1111-4111-8111-111111111111";

function claimedJob(overrides: Partial<ClaimedJob> = {}): ClaimedJob {
  return {
    id: JOB_ID,
    accountId: "22222222-2222-4222-8222-222222222222",
    createdBy: "33333333-3333-4333-8333-333333333333",
    params: { prompt: "a small red boat" },
    attemptNo: 1,
    providerId: "44444444-4444-4444-8444-444444444444",
    providerCode: "kie",
    providerBaseUrl: "https://api.kie.ai",
    providerModelId: "55555555-5555-4555-8555-555555555555",
    externalModelId: "z-image",
    modality: "image",
    entitlementId: null,
    microCreditsHeld: 2_000_000,
    holdId: "66666666-6666-4666-8666-666666666666",
    paramOverrides: {},
    providerUnitCostUsd: 0.005,
    estimatedCostUsd: 0.01,
    ...overrides,
  };
}

interface Recorder {
  runner: JobRunnerPort;
  attempts: AttemptRecord[];
  succeeded: SucceedInput[];
  failures: { jobId: string; errorCode: string; errorMessage: string }[];
}

function recorder(job: ClaimedJob | null, credentialFound = true): Recorder {
  const attempts: AttemptRecord[] = [];
  const succeeded: SucceedInput[] = [];
  const failures: { jobId: string; errorCode: string; errorMessage: string }[] = [];
  return {
    attempts,
    succeeded,
    failures,
    runner: {
      claim: async () => job,
      pickCredential: async () =>
        credentialFound ? { id: "77777777-7777-4777-8777-777777777777", label: "kie-1", secretRef: "KIE_API_KEY" } : null,
      recordAttempt: async (record) => {
        attempts.push(record);
        return "attempt-id";
      },
      succeed: async (input) => {
        succeeded.push(input);
      },
      fail: async (jobId, errorCode, errorMessage) => {
        failures.push({ jobId, errorCode, errorMessage });
      },
    },
  };
}

/** Answers `poll` from a script, one entry per call. */
function fakeProvider(script: (GenerationOutcome | Error)[], onSubmit?: () => never): GenerationProvider {
  let index = 0;
  return {
    code: "kie",
    submit: async () => {
      onSubmit?.();
      return {
        externalJobId: "task-1",
        endpoint: "https://api.kie.ai/api/v1/jobs/createTask",
        requestPayload: { model: "z-image" },
        responsePayload: { data: { taskId: "task-1" } },
        httpStatus: 200,
      };
    },
    poll: async () => {
      const next = script[Math.min(index++, script.length - 1)]!;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const succeededOutcome: GenerationOutcome = {
  state: "succeeded",
  outputs: [{ url: "https://cdn.kie.ai/out.png", kind: "image", mimeType: "image/png" }],
  providerUnitsCost: 0.8,
  responsePayload: { data: { state: "success" } },
};

/** Pretends the download and the upload both worked, and records where. */
/** Captures what the provider was actually handed, params included. */
function capturingProvider(script: (GenerationOutcome | Error)[]): { provider: GenerationProvider; submitted: Record<string, unknown>[] } {
  const submitted: Record<string, unknown>[] = [];
  let index = 0;
  return {
    submitted,
    provider: {
      code: "kie",
      submit: async (request) => {
        submitted.push(request.params as Record<string, unknown>);
        return {
          externalJobId: "task-1",
          endpoint: "https://api.test/submit",
          requestPayload: request.params,
          responsePayload: {},
          httpStatus: 200,
        };
      },
      poll: async () => {
        const next = script[Math.min(index++, script.length - 1)]!;
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

function fakeMirror(onMirror?: () => never): OutputMirrorPort {
  return {
    mirror: async (source, target) => {
      onMirror?.();
      return {
        kind: source.kind,
        mimeType: source.mimeType,
        bucket: "vgen",
        key: `generated/${target.accountId}/${target.jobId}/${target.index}.png`,
        byteSize: 1234,
        sha256: "abc",
      };
    },
  };
}

function deps(rec: Recorder, provider: GenerationProvider | null, overrides: Partial<Parameters<typeof runGeneration>[1]> = {}) {
  return {
    runner: rec.runner,
    createProvider: () => provider,
    mirror: fakeMirror(),
    secrets: { KIE_API_KEY: "test-key" },
    isFinalAttempt: false,
    sleep: async () => {},
    pollIntervalMs: 1,
    ...overrides,
  };
}

describe("running a generation", () => {
  it("captures the hold and files the outputs when the provider delivers", async () => {
    const rec = recorder(claimedJob());
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([{ state: "running", responsePayload: {} }, succeededOutcome])));

    expect(result).toEqual({ outcome: "succeeded", jobId: JOB_ID });
    expect(rec.succeeded).toHaveLength(1);
    expect(rec.succeeded[0]!.outputs).toHaveLength(1);
    expect(rec.succeeded[0]!.providerUnitsCost).toBe(0.8);
    // 0.8 KIE credits at $0.005 each — the trail the margin is audited from.
    expect(rec.succeeded[0]!.providerCostUsd).toBeCloseTo(0.004, 6);
    // Filed at our own key, not the provider's URL — that link expires.
    expect(rec.succeeded[0]!.outputs[0]).toMatchObject({ bucket: "vgen", sha256: "abc" });
    expect(rec.succeeded[0]!.outputs[0]!.key).toContain(JOB_ID);
    expect(rec.failures).toHaveLength(0);
    expect(rec.attempts.at(-1)!.status).toBe("succeeded");
  });

  it("does nothing at all when the job was already settled", async () => {
    // A duplicate delivery. The claim finds no claimable row, and the important
    // part is that nothing after it runs — a second capture would double-charge.
    const rec = recorder(null);
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome])));

    expect(result).toEqual({ outcome: "skipped", jobId: JOB_ID });
    expect(rec.succeeded).toHaveLength(0);
    expect(rec.failures).toHaveLength(0);
    expect(rec.attempts).toHaveLength(0);
  });

  it("refunds immediately when the provider refuses, without burning retries", async () => {
    const rec = recorder(claimedJob());
    const refusal: GenerationOutcome = {
      state: "failed",
      errorCode: "content_policy",
      errorMessage: "Prompt rejected.",
      retryable: false,
      responsePayload: { data: { state: "fail" } },
    };
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([refusal])));

    expect(result).toEqual({ outcome: "failed", jobId: JOB_ID, errorCode: "content_policy" });
    // The code survives -- it is on the allow-list because a person can act on
    // it -- but the provider's own wording does not reach the job row.
    expect(rec.failures).toEqual([{ jobId: JOB_ID, errorCode: "content_policy", errorMessage: "This prompt was refused." }]);
    expect(rec.succeeded).toHaveLength(0);
  });

  it("never lets a provider's own code or wording reach the customer", async () => {
    const rec = recorder(claimedJob());
    // What KIE actually does: `failCode` is its string, `failMsg` its prose.
    const refusal: GenerationOutcome = {
      state: "failed",
      errorCode: "ACCOUNT_BALANCE_INSUFFICIENT",
      errorMessage: "Insufficient credits. Please top up your account to continue.",
      retryable: false,
      responsePayload: { data: { state: "fail" } },
    };

    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([refusal])));

    // Collapsed to one of ours. An unrecognised code is the provider's, and a
    // customer reading it learns both that we resell and who from.
    expect(result).toEqual({ outcome: "failed", jobId: JOB_ID, errorCode: "provider_failed" });
    expect(rec.failures).toEqual([
      { jobId: JOB_ID, errorCode: "provider_failed", errorMessage: "This generation could not be completed." },
    ]);
    // The real reason is not thrown away -- it is on the attempt, which is
    // admin-only and is the row you debug from.
    expect(rec.attempts.at(-1)?.errorMessage).toContain("Insufficient credits");
  });

  it("asks for another delivery on a transient failure, settling nothing", async () => {
    const rec = recorder(claimedJob());
    const provider = fakeProvider([], () => {
      throw new ProviderTransportError("socket hang up");
    });
    const result = await runGeneration(JOB_ID, deps(rec, provider));

    expect(result.outcome).toBe("retry");
    // The hold stays. Releasing it here and re-holding on the next delivery
    // would charge the ledger for the network being unreliable.
    expect(rec.failures).toHaveLength(0);
    expect(rec.succeeded).toHaveLength(0);
  });

  it("settles a transient failure once the queue has no deliveries left", async () => {
    const rec = recorder(claimedJob());
    const provider = fakeProvider([], () => {
      throw new ProviderTransportError("socket hang up");
    });
    const result = await runGeneration(JOB_ID, deps(rec, provider, { isFinalAttempt: true }));

    expect(result).toMatchObject({ outcome: "failed", errorCode: "submit_failed" });
    expect(rec.failures).toHaveLength(1);
  });

  it("rides out a blip mid-poll and still succeeds", async () => {
    const rec = recorder(claimedJob());
    const provider = fakeProvider([new ProviderTransportError("ETIMEDOUT"), new ProviderTransportError("ETIMEDOUT"), succeededOutcome]);
    const result = await runGeneration(JOB_ID, deps(rec, provider));

    expect(result.outcome).toBe("succeeded");
    expect(rec.succeeded).toHaveLength(1);
  });

  it("refuses to charge for a success with no files behind it", async () => {
    const rec = recorder(claimedJob());
    const empty: GenerationOutcome = { state: "succeeded", outputs: [], providerUnitsCost: 1, responsePayload: {} };
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([empty])));

    expect(result).toMatchObject({ outcome: "failed", errorCode: "no_output" });
    expect(rec.succeeded).toHaveLength(0);
  });

  it("gives up and refunds when the provider never finishes", async () => {
    const rec = recorder(claimedJob());
    let clock = 0;
    const result = await runGeneration(
      JOB_ID,
      deps(rec, fakeProvider([{ state: "running", responsePayload: {} }]), {
        now: () => (clock += 1_000),
        pollTimeoutMs: 5_000,
      }),
    );

    expect(result).toMatchObject({ outcome: "failed", errorCode: "provider_timeout" });
    expect(rec.failures).toHaveLength(1);
    expect(rec.attempts.at(-1)!.status).toBe("timeout");
  });

  it("refunds a job whose provider has no adapter, rather than retrying an absence", async () => {
    // This is the useapi path today: grants are seeded, the serving rows exist,
    // and nothing can call them. The customer must not pay for that.
    const rec = recorder(claimedJob({ providerCode: "useapi", entitlementId: "88888888-8888-4888-8888-888888888888" }));
    const result = await runGeneration(JOB_ID, deps(rec, null));

    expect(result).toMatchObject({ outcome: "failed", errorCode: "provider_unavailable" });
    expect(rec.failures).toHaveLength(1);
    expect(rec.attempts[0]!.status).toBe("failed");
  });

  it("refunds when the credential's secret is not in the environment", async () => {
    const rec = recorder(claimedJob());
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome]), { secrets: {} }));

    expect(result).toMatchObject({ outcome: "failed", errorCode: "credential_unavailable" });
    expect(rec.succeeded).toHaveLength(0);
  });

  it("refunds when the result cannot be saved, rather than charging for a file nobody has", async () => {
    const rec = recorder(claimedJob());
    const mirror = fakeMirror(() => {
      throw new Error("the object store is unreachable");
    });
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome]), { mirror }));

    // Not retryable on purpose: another delivery re-enters at `submit` and
    // pays the provider a second time for a picture the customer already has.
    // The provider's charge is ours to absorb; the customer's is not.
    expect(result).toMatchObject({ outcome: "failed", errorCode: "storage_failed" });
    expect(rec.failures).toHaveLength(1);
    expect(rec.succeeded).toHaveLength(0);
    expect(rec.attempts.at(-1)!.errorCode).toBe("storage_failed");
  });

  it("does not settle a storage failure as a success even on the last attempt", async () => {
    const rec = recorder(claimedJob());
    const mirror = fakeMirror(() => {
      throw new Error("disk full");
    });
    const result = await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome]), { mirror, isFinalAttempt: true }));

    expect(result).toMatchObject({ outcome: "failed", errorCode: "storage_failed" });
    expect(rec.succeeded).toHaveLength(0);
  });

  it("records which credential served the call", async () => {
    const rec = recorder(claimedJob());
    await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome])));

    // job_attempts.credential_id exists to answer "whose quota did that burn",
    // which is unanswerable after the fact if it is not written at the time.
    expect(rec.attempts.every((a) => a.credentialId === "77777777-7777-4777-8777-777777777777")).toBe(true);
    expect(rec.attempts[0]!.externalJobId).toBe("task-1");
  });
});

describe("sending a job somewhere else", () => {
  it("translates the params before submitting, and leaves the job's own untouched", async () => {
    const job = claimedJob({
      params: { prompt: "a small red boat", aspect_ratio: "16:9" },
      paramOverrides: { rename: { aspect_ratio: "size" }, map: { size: { "16:9": "1344*768" } }, set: { output_format: "png" } },
    });
    const rec = recorder(job);
    const { provider, submitted } = capturingProvider([succeededOutcome]);

    await runGeneration(JOB_ID, deps(rec, provider));

    // What the provider is sent speaks its own vocabulary...
    expect(submitted[0]).toEqual({ prompt: "a small red boat", size: "1344*768", output_format: "png" });
    // ...and what the customer asked for is still what the price was hashed
    // from. A route that rewrote this would make the gallery disagree with the
    // charge.
    expect(job.params).toEqual({ prompt: "a small red boat", aspect_ratio: "16:9" });
  });

  it("sends the params through unchanged when there is no route", async () => {
    const rec = recorder(claimedJob({ params: { prompt: "x", aspect_ratio: "1:1" } }));
    const { provider, submitted } = capturingProvider([succeededOutcome]);

    await runGeneration(JOB_ID, deps(rec, provider));

    expect(submitted[0]).toEqual({ prompt: "x", aspect_ratio: "1:1" });
  });

  it("costs the job at the serving provider's rate, not a constant", async () => {
    // 0.8 units at $1.00 each. Under the old hardcoded map this was always
    // KIE's $0.005 and every WaveSpeed job would have been costed 200x low.
    const rec = recorder(claimedJob({ providerCode: "wavespeed", providerUnitCostUsd: 1 }));

    await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome])));

    expect(rec.succeeded[0]!.providerCostUsd).toBeCloseTo(0.8);
  });

  it("falls back to the quote's estimate when the provider reports no cost", async () => {
    const rec = recorder(claimedJob({ providerCode: "wavespeed", providerUnitCostUsd: 1, estimatedCostUsd: 0.04 }));
    const silent: GenerationOutcome = { ...succeededOutcome, providerUnitsCost: null };

    await runGeneration(JOB_ID, deps(rec, fakeProvider([silent])));

    // WaveSpeed reports nothing on any documented endpoint. Leaving this null
    // would blank the margin trail for every job it serves.
    expect(rec.succeeded[0]!.providerCostUsd).toBe(0.04);
    // The attempt still records null, so "they told us" and "we worked it out"
    // stay distinguishable.
    expect(rec.attempts.at(-1)!.providerUnitsCost).toBeNull();
  });

  it("records no cost at all when there is neither a rate nor an estimate", async () => {
    const rec = recorder(claimedJob({ providerUnitCostUsd: null, estimatedCostUsd: null }));

    await runGeneration(JOB_ID, deps(rec, fakeProvider([succeededOutcome])));

    // Null, not zero. Zero reads as "this was free" and would quietly make an
    // unrated provider look like pure margin.
    expect(rec.succeeded[0]!.providerCostUsd).toBeNull();
  });
});
