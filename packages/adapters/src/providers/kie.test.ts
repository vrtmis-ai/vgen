import { describe, expect, it } from "vitest";
import { KieGenerationProvider, describeOutput } from "./kie";
import { ProviderTransportError } from "./types";

/**
 * The adapter against the exact bodies `scripts/spike-kie.ts` saw on the live
 * API. Each test is a quirk that cost real credits to discover, pinned so a
 * refactor cannot quietly un-discover it.
 */

function stubFetch(responses: ({ status: number; body: unknown } | Error)[]): typeof globalThis.fetch {
  let index = 0;
  return (async () => {
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "Content-Type": "application/json" } });
  }) as typeof globalThis.fetch;
}

describe("the KIE adapter", () => {
  it("submits a task and returns everything job_attempts needs", async () => {
    const provider = new KieGenerationProvider({ fetch: stubFetch([{ status: 200, body: { code: 200, data: { taskId: "t-1" } } }]) });

    const submission = await provider.submit({ externalModelId: "z-image", params: { prompt: "a boat" }, apiKey: "k" });

    expect(submission.externalJobId).toBe("t-1");
    expect(submission.endpoint).toBe("https://api.kie.ai/api/v1/jobs/createTask");
    expect(submission.requestPayload).toEqual({ model: "z-image", input: { prompt: "a boat" } });
    expect(submission.httpStatus).toBe(200);
  });

  it("treats a 200 with no task id as a failure", async () => {
    // The spike's finding: KIE puts a failure code inside a 200 body, so the
    // status line alone is not the answer. A missing task id is the error.
    const provider = new KieGenerationProvider({ fetch: stubFetch([{ status: 200, body: { code: 402, msg: "Insufficient credits" } }]) });

    await expect(provider.submit({ externalModelId: "z-image", params: {}, apiKey: "k" })).rejects.toThrow(/Insufficient credits/);
  });

  it("marks a 4xx submission as not worth retrying, and a 5xx as worth it", async () => {
    const clientError = new KieGenerationProvider({ fetch: stubFetch([{ status: 400, body: { msg: "bad model" } }]) });
    const serverError = new KieGenerationProvider({ fetch: stubFetch([{ status: 503, body: { msg: "upstream down" } }]) });

    await expect(clientError.submit({ externalModelId: "nope", params: {}, apiKey: "k" })).rejects.toMatchObject({ retryable: false });
    await expect(serverError.submit({ externalModelId: "z-image", params: {}, apiKey: "k" })).rejects.toMatchObject({ retryable: true });
  });

  it("parses resultJson, which arrives as a JSON string inside the JSON body", async () => {
    const provider = new KieGenerationProvider({
      fetch: stubFetch([
        {
          status: 200,
          body: {
            data: {
              state: "success",
              creditsConsumed: 0.8,
              resultJson: JSON.stringify({ resultUrls: ["https://cdn.kie.ai/a.png", "https://cdn.kie.ai/b.png"] }),
            },
          },
        },
      ]),
    });

    const outcome = await provider.poll("t-1", "k");

    expect(outcome.state).toBe("succeeded");
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.outputs.map((o) => o.url)).toEqual(["https://cdn.kie.ai/a.png", "https://cdn.kie.ai/b.png"]);
    expect(outcome.providerUnitsCost).toBe(0.8);
  });

  it("survives a resultJson it cannot parse instead of taking the worker down", async () => {
    const provider = new KieGenerationProvider({
      fetch: stubFetch([{ status: 200, body: { data: { state: "success", resultJson: "not json at all" } } }]),
    });

    const outcome = await provider.poll("t-1", "k");

    // No outputs is a failure the runner handles by refunding. A throw here
    // would instead be an unhandled crash on a job that already cost money.
    expect(outcome.state).toBe("succeeded");
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.outputs).toEqual([]);
  });

  it("reports an unfinished task as running, whatever the state is called", async () => {
    const provider = new KieGenerationProvider({ fetch: stubFetch([{ status: 200, body: { data: { state: "generating" } } }]) });

    expect((await provider.poll("t-1", "k")).state).toBe("running");
  });

  it("carries the provider's own failure code through, and does not retry it", async () => {
    const provider = new KieGenerationProvider({
      fetch: stubFetch([{ status: 200, body: { data: { state: "fail", failCode: "content_policy", failMsg: "Prompt rejected." } } }]),
    });

    const outcome = await provider.poll("t-1", "k");

    expect(outcome).toMatchObject({ state: "failed", errorCode: "content_policy", errorMessage: "Prompt rejected.", retryable: false });
  });

  it("turns a dead socket into a retryable transport error", async () => {
    const provider = new KieGenerationProvider({ fetch: stubFetch([new Error("ECONNRESET")]) });

    await expect(provider.poll("t-1", "k")).rejects.toBeInstanceOf(ProviderTransportError);
  });

  it("keeps an HTML error page as evidence rather than crashing on it", async () => {
    const provider = new KieGenerationProvider({
      fetch: (async () => new Response("<html>502</html>", { status: 200 })) as typeof globalThis.fetch,
    });

    // A 200 whose body is not JSON parses to { nonJson }, which has no `data`,
    // so this surfaces as an unusable response rather than a parser throw.
    await expect(provider.poll("t-1", "k")).rejects.toBeInstanceOf(ProviderTransportError);
  });
});

describe("typing an output URL", () => {
  it("reads the extension when there is one", () => {
    expect(describeOutput("https://cdn.kie.ai/a.mp4", "image")).toMatchObject({ kind: "video", mimeType: "video/mp4" });
    expect(describeOutput("https://cdn.kie.ai/a.webp", "image")).toMatchObject({ kind: "image", mimeType: "image/webp" });
  });

  it("falls back to the model's modality on a signed URL with no extension", () => {
    expect(describeOutput("https://cdn.kie.ai/file?token=abc", "video")).toMatchObject({ kind: "video", mimeType: "video/mp4" });
  });

  it("ignores a query string that looks like an extension", () => {
    expect(describeOutput("https://cdn.kie.ai/out.png?v=1.mp4", "image")).toMatchObject({ kind: "image", mimeType: "image/png" });
  });
});
