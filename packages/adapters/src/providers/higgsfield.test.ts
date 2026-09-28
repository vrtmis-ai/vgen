import { describe, expect, it } from "vitest";
import { HiggsfieldGenerationProvider } from "./higgsfield";
import { ProviderTransportError } from "./types";

/**
 * The Higgsfield adapter against the shapes its documentation publishes.
 *
 * These fixtures are transcribed from `docs.higgsfield.ai`, not captured from a
 * live call, which is this adapter's honest weakness and the reason
 * `scripts/spike-higgsfield.ts` exists. What the suite can prove without a live
 * call is everything that does not depend on the fixtures being right: that a
 * documented body is read the way the docs describe, that an undocumented one
 * fails loudly instead of quietly, and above all where the
 * retryable/not-retryable line falls.
 *
 * That line is the money one here in a way it is not for the other two
 * providers. Higgsfield has **no idempotency key** and its own documentation says
 * not to repeat a generation POST after an ambiguous timeout — so an over-eager
 * retry on submit pays twice for one generation, while an under-eager one on the
 * concurrency ceiling refuses a customer for a reason that clears itself in
 * seconds. Both directions cost money, which is why both have a test.
 */

interface Call {
  url: string;
  init: RequestInit | undefined;
}

interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  /** A socket that never answered, as opposed to an answer we did not like. */
  throws?: string;
}

function fakeFetch(responses: Answer[]): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses[Math.min(index++, responses.length - 1)]!;
    if (next.throws) throw new Error(next.throws);
    return new Response(next.body === undefined ? "" : JSON.stringify(next.body), {
      status: next.status,
      ...(next.headers ? { headers: next.headers } : {}),
    });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: fetchImpl, calls };
}

const provider = (responses: Answer[], modality: "image" | "video" | "audio" = "video") => {
  const { fetch, calls } = fakeFetch(responses);
  return { provider: new HiggsfieldGenerationProvider({ fetch, modality }), calls };
};

const REQUEST_ID = "d7e6c0f3-6699-4f6c-bb45-2ad7fd9158ff";

/** `concepts/requests.md`, verbatim: the id is at the top level, not under `data`. */
const SUBMITTED = {
  status: "queued",
  request_id: REQUEST_ID,
  status_url: `https://api.higgsfield.ai/requests/${REQUEST_ID}/status`,
  cancel_url: `https://api.higgsfield.ai/requests/${REQUEST_ID}/cancel`,
};

const status = (extra: Record<string, unknown>) => ({ status: "completed", request_id: REQUEST_ID, ...extra });

describe("submitting", () => {
  it("puts the mode id in the path, the params flat in the body, and authenticates with Key", async () => {
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);

    const submission = await subject.submit({
      externalModelId: "higgsfield/cinema-studio/4.0",
      params: { prompt: "a cinematic tracking shot", duration: 5, resolution: "720p" },
      apiKey: "key-id:key-secret",
    });

    // The slashes in the mode id are real path segments. Percent-encoding the id
    // as a whole — the way a task id would be — posts to a path that does not
    // exist, and Higgsfield answers 405 for every path, so it would not say so.
    expect(calls[0]?.url).toBe("https://api.higgsfield.ai/higgsfield/cinema-studio/4.0");
    expect(submission.endpoint).toBe("https://api.higgsfield.ai/higgsfield/cinema-studio/4.0");

    // `Key`, not `Bearer`, and the id:secret pair travels as the one string both
    // official SDKs take.
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Key key-id:key-secret");

    // Flat, with no `input` wrapper. KIE nests; this does not.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ prompt: "a cinematic tracking shot", duration: 5, resolution: "720p" });
  });

  it("retypes the parameters Higgsfield does not accept as strings", async () => {
    // DEEV's controls produce strings and these schemas want integers, numbers
    // and booleans. There is no route on an own-provider catalogue row, so no
    // `map` override can do it; the 422 would land after the coins are held.
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);
    await subject.submit({
      externalModelId: "kling-video/o3/first-last-frame",
      params: {
        prompt: "keep me a string",
        duration: "10",
        batch_size: "4",
        seed: "42",
        style_strength: "0.5",
        generate_audio: "true",
        multi_shots: "false",
        resolution: "720p",
      },
      apiKey: "k",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      prompt: "keep me a string",
      duration: 10,
      batch_size: 4,
      seed: 42,
      style_strength: 0.5,
      generate_audio: true,
      multi_shots: false,
      resolution: "720p",
    });
  });

  it("drops an empty choice instead of sending it, because the field must be absent", async () => {
    // Checked live 2026-09-27: `era: "auto"` and `era: ""` BOTH answer 400
    // ("is not one of ['1960s', …]"), and omitting the key answers 200. The
    // catalogue's "auto" options therefore carry "" and this turns that into an
    // absent field. Same rule covers Marketing Studio's optional preset.
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);
    await subject.submit({
      externalModelId: "higgsfield/cinema-studio/4.0",
      params: { prompt: "a road", era: "", genre: "noir", color_palette: "", preset_id: "" },
      apiKey: "k",
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ prompt: "a road", genre: "noir" });
  });

  it("passes a value that does not convert straight through, so they reject it and say why", async () => {
    const { provider: subject, calls } = provider([{ status: 200, body: SUBMITTED }]);
    await subject.submit({ externalModelId: "m", params: { duration: "about five", generate_audio: "yes" }, apiKey: "k" });
    // Neither becomes NaN or false. Guessing here would send a number nobody
    // chose; letting it through gets a 422 naming the field.
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ duration: "about five", generate_audio: "yes" });
  });

  it("reads request_id from the top level, not from a data envelope", async () => {
    const { provider: subject } = provider([{ status: 200, body: SUBMITTED }]);
    const submission = await subject.submit({ externalModelId: "marketing-studio/image", params: { prompt: "x" }, apiKey: "k" });
    expect(submission.externalJobId).toBe(REQUEST_ID);
    expect(submission.httpStatus).toBe(200);
  });

  it("keeps the whole response and the correlation id support asks for", async () => {
    const { provider: subject } = provider([{ status: 200, body: SUBMITTED, headers: { "x-correlation-id": "corr-123" } }]);
    const submission = await subject.submit({ externalModelId: "marketing-studio/image", params: { prompt: "x" }, apiKey: "k" });
    expect(submission.responsePayload).toMatchObject({ status: "queued", request_id: REQUEST_ID, correlationId: "corr-123" });
  });

  it("treats a 200 with no request_id as a failure rather than a submitted job", async () => {
    const { provider: subject } = provider([{ status: 200, body: { status: "queued" } }]);
    await expect(subject.submit({ externalModelId: "m", params: {}, apiKey: "k" })).rejects.toThrow(ProviderTransportError);
  });

  it("retries the concurrency ceiling, which arrives as a 400 and clears itself", async () => {
    // Two concurrent generations on a new account, and no Retry-After. The
    // message is the only signal that this 400 is capacity and not a bad body.
    const { provider: subject } = provider([
      { status: 400, body: { detail: "Maximum number of concurrent requests (2) has been reached" } },
    ]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).retryable).toBe(true);
  });

  it("does not retry any other 400", async () => {
    const { provider: subject } = provider([{ status: 400, body: { detail: "resolution must be one of 480p, 720p" } }]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect((error as ProviderTransportError).retryable).toBe(false);
  });

  it.each([
    [401, "Invalid credentials"],
    [403, "Insufficient credits"],
    [422, "Request body validation failed"],
  ])("does not retry %i", async (code, detail) => {
    const { provider: subject } = provider([{ status: code, body: { detail } }]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect((error as ProviderTransportError).retryable).toBe(false);
  });

  it.each([
    [429, "rate limited"],
    [500, "server error"],
    [503, "model not ready"],
    // Their table says retry later, and the adapter must agree with it.
    [423, "model temporarily blocked"],
    // Not in their table at all. Seen live on 2026-09-27: "This model is
    // temporarily unavailable. Please try again later or contact support."
    [409, "This model is temporarily unavailable. Please try again later or contact support."],
  ])("retries %i, which is theirs and may improve", async (code, detail) => {
    const { provider: subject } = provider([{ status: code, body: { detail } }]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect((error as ProviderTransportError).retryable).toBe(true);
  });

  it("does NOT retry a submit that never got an answer", async () => {
    // The deliberate disagreement with the other two adapters, and the reason is
    // in their docs: there is no idempotency key, so a POST that may already have
    // been accepted must not be sent again. A second attempt would bill
    // Higgsfield twice for one generation, and no refund of ours undoes that.
    const { provider: subject } = provider([{ status: 0, body: undefined, throws: "socket hang up" }]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).retryable).toBe(false);
    expect((error as Error).message).toBe("socket hang up");
  });

  it("summarises a FastAPI validation list instead of stringifying it", async () => {
    const { provider: subject } = provider([
      {
        status: 422,
        body: { detail: [{ loc: ["body", "prompt"], msg: "field required" }, { loc: ["body", "duration"] }] },
      },
    ]);
    const error = await subject.submit({ externalModelId: "m", params: {}, apiKey: "k" }).catch((caught: unknown) => caught);
    expect((error as Error).message).toBe("rejected: body.prompt, body.duration");
  });
});

describe("polling", () => {
  const poll = (answers: Answer[], modality: "image" | "video" | "audio" = "video") =>
    provider(answers, modality).provider.poll(REQUEST_ID, "k");

  it("asks the status path it rebuilds from the id", async () => {
    const { provider: subject, calls } = provider([{ status: 200, body: { status: "queued", request_id: REQUEST_ID } }]);
    await subject.poll(REQUEST_ID, "k");
    expect(calls[0]?.url).toBe(`https://api.higgsfield.ai/requests/${REQUEST_ID}/status`);
  });

  it.each(["queued", "in_progress"])("keeps waiting on %s", async (state) => {
    const outcome = await poll([{ status: 200, body: { status: state, request_id: REQUEST_ID } }]);
    expect(outcome.state).toBe("running");
  });

  it("keeps waiting on a status nobody has documented", async () => {
    // A status we have not seen is not evidence of failure, and treating it as
    // one would refund a generation that was about to succeed.
    const outcome = await poll([{ status: 200, body: { status: "rendering", request_id: REQUEST_ID } }]);
    expect(outcome.state).toBe("running");
  });

  it("reads a list of images", async () => {
    const outcome = await poll(
      [{ status: 200, body: status({ images: [{ url: "https://cdn.example.com/a.jpg" }, { url: "https://cdn.example.com/b.jpg" }] }) }],
      "image",
    );
    expect(outcome).toMatchObject({ state: "succeeded" });
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.outputs).toEqual([
      { url: "https://cdn.example.com/a.jpg", kind: "image", mimeType: "image/jpeg" },
      { url: "https://cdn.example.com/b.jpg", kind: "image", mimeType: "image/jpeg" },
    ]);
  });

  it("reads a single video object", async () => {
    const outcome = await poll([{ status: 200, body: status({ video: { url: "https://cdn.example.com/v.mp4" } }) }]);
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.outputs).toEqual([{ url: "https://cdn.example.com/v.mp4", kind: "video", mimeType: "video/mp4" }]);
  });

  it("does not mirror the same audio twice when both audio and audios are sent", async () => {
    // `concepts/requests.md` shows an audio result carrying both keys with the
    // same URL. Counted once, or the mirror stores one file under two names.
    const outcome = await poll(
      [
        {
          status: 200,
          body: status({ audio: { url: "https://cdn.example.com/a.mp3" }, audios: [{ url: "https://cdn.example.com/a.mp3" }] }),
        },
      ],
      "audio",
    );
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.outputs).toEqual([{ url: "https://cdn.example.com/a.mp3", kind: "audio", mimeType: "audio/mpeg" }]);
  });

  it("reports no provider cost, because the status body does not carry one", async () => {
    const outcome = await poll([{ status: 200, body: status({ video: { url: "https://cdn.example.com/v.mp4" } }) }]);
    if (outcome.state !== "succeeded") throw new Error("unreachable");
    expect(outcome.providerUnitsCost).toBeNull();
  });

  it("calls moderation what it is, so the customer is told the truth", async () => {
    // `content_policy` is in the worker's PUBLIC_FAILURE table; inventing a code
    // here would collapse to "provider_failed" and tell somebody their
    // generation broke when it was refused. Higgsfield charges nothing for it.
    const outcome = await poll([{ status: 200, body: { status: "nsfw", request_id: REQUEST_ID } }]);
    expect(outcome).toMatchObject({ state: "failed", errorCode: "content_policy", retryable: false });
  });

  it.each([
    ["failed", "provider_failed"],
    ["canceled", "provider_cancelled"],
  ])("maps %s to %s and does not retry it", async (state, code) => {
    const outcome = await poll([{ status: 200, body: { status: state, request_id: REQUEST_ID, error: "Generation failed" } }]);
    expect(outcome).toMatchObject({ state: "failed", errorCode: code, retryable: false });
  });

  it("does retry a poll that never got an answer", async () => {
    // The mirror image of submit: a GET creates nothing, so asking again is free
    // and refusing to ask would abandon a generation already paid for.
    const error = await poll([{ status: 0, body: undefined, throws: "ETIMEDOUT" }]).catch((caught: unknown) => caught);
    expect((error as ProviderTransportError).retryable).toBe(true);
  });

  it("asks again on a proxy's HTML rather than reading it as a running job", async () => {
    // It arrives as `{nonJson: "<html>…"}`, which has keys, so an emptiness check
    // would let it through and the missing `status` would read as "not terminal
    // yet". Retryable, because a 200 from a proxy says nothing about the job.
    const subject = new HiggsfieldGenerationProvider({
      fetch: (async () => new Response("<html>502 Bad Gateway</html>", { status: 200 })) as unknown as typeof globalThis.fetch,
    });
    const error = await subject.poll(REQUEST_ID, "k").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderTransportError);
    expect((error as ProviderTransportError).retryable).toBe(true);
  });

  it("stops on a 404, which means the id is wrong and will stay wrong", async () => {
    const error = await poll([{ status: 404, body: { detail: "Not found" } }]).catch((caught: unknown) => caught);
    expect((error as ProviderTransportError).retryable).toBe(false);
  });
});
