import { describe, expect, it } from "vitest";
import { ProviderTransportError } from "./types";
import { WaveSpeedGenerationProvider } from "./wavespeed";

/**
 * The WaveSpeed adapter against the shapes its documentation publishes.
 *
 * These fixtures are transcribed from wavespeed.ai/docs, not captured from a
 * live call — which is the honest weakness of this adapter and the reason
 * `scripts/spike-wavespeed.ts` exists. What the suite can still prove is
 * everything that does not depend on the shapes being right: that a documented
 * body is parsed the way the docs describe, that an undocumented one fails
 * loudly rather than silently, and above all that the retryable/not-retryable
 * split lands where it should. That split is the money one — a retryable
 * failure keeps the customer's hold, a terminal one refunds it.
 */

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(responses: { status: number; body: unknown }[]): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

const provider = (responses: { status: number; body: unknown }[], modality: "image" | "video" = "image") => {
  const { fetch, calls } = fakeFetch(responses);
  return { provider: new WaveSpeedGenerationProvider({ fetch, modality }), calls };
};

const SUBMITTED = {
  code: 200,
  message: "success",
  data: {
    id: "e6832d4abffb4d79bfbca19783fca133",
    status: "created",
    urls: { get: "https://api.wavespeed.ai/api/v3/predictions/e6832d4abffb4d79bfbca19783fca133/result" },
  },
};

const completed = (outputs: unknown[]) => ({
  code: 200,
  message: "success",
  data: {
    id: "e6832d4abffb4d79bfbca19783fca133",
    model: "wavespeed-ai/qwen-image/text-to-image",
    status: "completed",
    outputs,
    error: "",
    timings: { inference: 2500 },
    created_at: "2026-05-19T06:09:15.948268264Z",
  },
});

describe("submitting", () => {
  it("puts the model in the path and the params flat in the body", async () => {
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);

    const submission = await subject.submit({
      externalModelId: "wavespeed-ai/qwen-image/text-to-image",
      params: { prompt: "a small red boat", size: "1024*1024" },
      apiKey: "secret",
    });

    // The single biggest difference from KIE, and the one that breaks silently:
    // KIE posts {model, input} to one endpoint, WaveSpeed puts the model id in
    // the URL. The slashes are real path segments and must survive.
    expect(calls[0]!.url).toBe("https://api.wavespeed.ai/api/v3/wavespeed-ai/qwen-image/text-to-image");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ prompt: "a small red boat", size: "1024*1024" });
    expect(submission.externalJobId).toBe("e6832d4abffb4d79bfbca19783fca133");
    expect(submission.httpStatus).toBe(200);
  });

  it("sends the key as a bearer token", async () => {
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);
    await subject.submit({ externalModelId: "m", params: {}, apiKey: "secret" });
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  it("keeps the whole response, because job_attempts is where a charge is explained", async () => {
    const { provider: subject } = provider([{ status: 200, body: SUBMITTED }]);
    const submission = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" });
    expect(submission.responsePayload).toEqual(SUBMITTED);
  });

  it("refuses to retry a 400 — the same body gets the same answer", async () => {
    const { provider: subject } = provider([{ status: 400, body: { code: 400, message: "prompt is required" } }]);

    await expect(subject.submit({ externalModelId: "m", params: {}, apiKey: "k" })).rejects.toMatchObject({
      message: "prompt is required",
      retryable: false,
    });
  });

  it("retries a 429 and a 500 — those are theirs, not ours", async () => {
    for (const status of [429, 500]) {
      const { provider: subject } = provider([{ status, body: { message: "slow down" } }]);
      await expect(subject.submit({ externalModelId: "m", params: {}, apiKey: "k" })).rejects.toMatchObject({ retryable: true });
    }
  });

  it("treats a 200 with no id as a failure, not a submission", async () => {
    // A task we cannot poll for is not a task. Returning a submission here
    // would leave the job running until the poll timeout refunds it, ten
    // minutes later.
    const { provider: subject } = provider([{ status: 200, body: { code: 200, data: {} } }]);
    await expect(subject.submit({ externalModelId: "m", params: {}, apiKey: "k" })).rejects.toBeInstanceOf(ProviderTransportError);
  });
});

describe("polling", () => {
  it("asks the result endpoint for the id it was given", async () => {
    const { provider: subject, calls } = provider([completed(["https://cdn.wavespeed.ai/a.png"])].map((body) => ({ status: 200, body })));
    await subject.poll("task-1", "k");
    // Rebuilt rather than followed from `urls.get`: a URL the provider hands
    // back is a URL the provider chooses, and this one is derivable.
    expect(calls[0]!.url).toBe("https://api.wavespeed.ai/api/v3/predictions/task-1/result");
  });

  it("keeps waiting through created and processing", async () => {
    for (const status of ["created", "processing"]) {
      const { provider: subject } = provider([{ status: 200, body: { data: { id: "x", status } } }]);
      expect((await subject.poll("x", "k")).state).toBe("running");
    }
  });

  it("keeps waiting on a status it has never seen", async () => {
    // The dangerous direction is treating an unknown state as terminal: that
    // refunds a generation that was about to succeed. Waiting costs time and
    // the poll timeout is the backstop.
    const { provider: subject } = provider([{ status: 200, body: { data: { id: "x", status: "queued_behind_others" } } }]);
    expect((await subject.poll("x", "k")).state).toBe("running");
  });

  it("reads the outputs off data.outputs as plain URLs", async () => {
    const { provider: subject } = provider([
      { status: 200, body: completed(["https://cdn.wavespeed.ai/a.png", "https://cdn.wavespeed.ai/b.jpeg"]) },
    ]);

    const outcome = await subject.poll("x", "k");

    expect(outcome.state).toBe("succeeded");
    if (outcome.state !== "succeeded") return;
    expect(outcome.outputs).toEqual([
      { url: "https://cdn.wavespeed.ai/a.png", kind: "image", mimeType: "image/png" },
      { url: "https://cdn.wavespeed.ai/b.jpeg", kind: "image", mimeType: "image/jpeg" },
    ]);
  });

  it("reports no cost, because no documented endpoint gives one", async () => {
    const { provider: subject } = provider([{ status: 200, body: completed(["https://cdn.wavespeed.ai/a.png"]) }]);
    const outcome = await subject.poll("x", "k");
    if (outcome.state !== "succeeded") throw new Error("expected success");
    // Null rather than zero. Zero would read as "this was free" and quietly
    // make every WaveSpeed job look like pure margin.
    expect(outcome.providerUnitsCost).toBeNull();
  });

  it("drops anything in outputs that is not a URL string", async () => {
    const { provider: subject } = provider([{ status: 200, body: completed([{ url: "https://x/a.png" }, "", 42]) }]);
    const outcome = await subject.poll("x", "k");
    if (outcome.state !== "succeeded") throw new Error("expected success");
    // Which leaves zero outputs, and the runner turns a success with nothing
    // attached into a refund rather than a charge.
    expect(outcome.outputs).toEqual([]);
  });

  it("falls back to the row's modality when the URL has no extension", async () => {
    const { provider: subject } = provider([{ status: 200, body: completed(["https://cdn.wavespeed.ai/x?sig=abc"]) }], "video");
    const outcome = await subject.poll("x", "k");
    if (outcome.state !== "succeeded") throw new Error("expected success");
    expect(outcome.outputs[0]).toEqual({ url: "https://cdn.wavespeed.ai/x?sig=abc", kind: "video", mimeType: "video/mp4" });
  });

  it("does not retry a refusal", async () => {
    const { provider: subject } = provider([{ status: 200, body: { data: { id: "x", status: "failed", error: "content policy" } } }]);

    const outcome = await subject.poll("x", "k");

    expect(outcome).toMatchObject({ state: "failed", errorCode: "provider_failed", errorMessage: "content policy", retryable: false });
  });

  it("names cancelled and timeout distinctly, and retries neither", async () => {
    for (const [status, code] of [
      ["cancelled", "provider_cancelled"],
      ["timeout", "provider_timeout"],
    ]) {
      const { provider: subject } = provider([{ status: 200, body: { data: { id: "x", status } } }]);
      const outcome = await subject.poll("x", "k");
      // A timeout upstream is the expensive one to retry: their task may still
      // be running, so a second submit pays for two of a thing asked for once.
      expect(outcome).toMatchObject({ state: "failed", errorCode: code, retryable: false });
    }
  });

  it("treats an empty body as transport trouble, not as a finished job", async () => {
    const { provider: subject } = provider([{ status: 200, body: { code: 200, data: {} } }]);
    await expect(subject.poll("x", "k")).rejects.toBeInstanceOf(ProviderTransportError);
  });

  it("keeps an HTML error page instead of crashing on it", async () => {
    const { fetch } = (() => {
      const impl = (async () => new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof globalThis.fetch;
      return { fetch: impl };
    })();
    const subject = new WaveSpeedGenerationProvider({ fetch });
    await expect(subject.poll("x", "k")).rejects.toMatchObject({ retryable: true });
  });

  it("retries when the socket dies, because we do not know whether it ran", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof globalThis.fetch;
    const subject = new WaveSpeedGenerationProvider({ fetch: fetchImpl });
    await expect(subject.poll("x", "k")).rejects.toMatchObject({ message: "ECONNRESET", retryable: true });
  });
});
