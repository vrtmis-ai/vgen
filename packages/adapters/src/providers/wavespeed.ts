import { describeOutput } from "./output";
import {
  ProviderTransportError,
  type GenerationOutcome,
  type GenerationOutput,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationSubmission,
  type JsonObject,
  type Modality,
} from "./types";

/**
 * WaveSpeed, against the published REST documentation.
 *
 * HALF VERIFIED, and the halves are worth keeping straight.
 *
 * **Proved against the live API on 2026-08-22**, with a real key on a $0
 * account: the request shape is accepted, a bad key is rejected as one, a model
 * they do not have is named as missing, and every 4xx body parses where
 * `submit` reads it. All three failure modes come back through
 * `ProviderTransportError` as not-retryable, which is right — none of them
 * improves on a second attempt.
 *
 * **Still from the documentation alone**: everything after a successful submit.
 * `data.id`, the polling states, and whether `data.outputs` is really an array
 * of URL strings have never been seen, because a $0 account cannot generate.
 * `scripts/spike-wavespeed.ts` settles the rest for about two cents the moment
 * there is credit, and until then every `model_routes` row pointing here ships
 * inactive.
 *
 * Four differences from KIE shape the whole file:
 *
 *   - the model id is in the URL PATH, not the body. KIE posts `{model, input}`
 *     to one endpoint; WaveSpeed posts the params to `/api/v3/{model}`.
 *   - the params are FLAT in the body, not nested under `input`.
 *   - the result is `data.outputs`, a plain array of URLs. No second
 *     `JSON.parse` of a string inside the JSON, which is KIE's quirk.
 *   - nothing reports what a prediction cost. `providerUnitsCost` is therefore
 *     always null, and settlement falls back to the estimate the quote already
 *     recorded rather than inventing a number here.
 *
 * The API key arrives per call for the same reason it does on KIE: which
 * credential out of the pool is used is decided per job, not once at startup.
 */

const DEFAULT_BASE_URL = "https://api.wavespeed.ai";

/**
 * Terminal states. `created` and `processing` are absent on purpose — they mean
 * "ask again", and so does anything unrecognised, because a status we have not
 * seen before is not evidence that the generation failed.
 */
const TERMINAL: Record<string, "succeeded" | "failed"> = {
  completed: "succeeded",
  failed: "failed",
  cancelled: "failed",
  timeout: "failed",
};

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** WaveSpeed nests the answer under `data` on every endpoint, as KIE does. */
function dataOf(body: unknown): JsonObject {
  return asRecord(asRecord(body).data);
}

/** Their message, if they left one, else ours. */
function messageFrom(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const message = record.message ?? record.error ?? dataOf(body).error;
  return typeof message === "string" && message.trim() !== "" ? message : fallback;
}

/** 5xx and 429 are theirs and worth another go; 4xx is ours and will not improve. */
function retryable(status: number): boolean {
  return status >= 500 || status === 429;
}

export interface WaveSpeedProviderOptions {
  baseUrl?: string | undefined;
  /** The modality of what is being generated, used to type outputs. */
  modality?: Modality | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  /** Per-request timeout. A provider that never answers must not pin a worker. */
  timeoutMs?: number | undefined;
}

export class WaveSpeedGenerationProvider implements GenerationProvider {
  readonly code = "wavespeed";
  private readonly baseUrl: string;
  private readonly modality: Modality;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: WaveSpeedProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.modality = options.modality ?? "image";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async call(url: string, apiKey: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal,
        headers: { Authorization: `Bearer ${apiKey}`, ...(init.headers ?? {}) },
      });
    } catch (error) {
      // Never got an answer, so we do not know whether it ran. Retryable by
      // default: the alternative is refusing a customer's generation because a
      // socket blipped.
      throw new ProviderTransportError(error instanceof Error ? error.message : "request failed");
    }
    const text = await response.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Kept rather than thrown on. An HTML error page from a proxy is a fact
      // worth storing in job_attempts.response_payload, not a parser crash.
      body = { nonJson: text.slice(0, 4_000) };
    }
    return { status: response.status, body };
  }

  async submit(request: GenerationRequest): Promise<GenerationSubmission> {
    // The model id is a path, not a parameter. `wavespeed-ai/z-image/turbo` has
    // slashes in it and they are real path segments, so it must not be
    // percent-encoded as a whole the way KIE's task id is.
    const endpoint = `${this.baseUrl}/api/v3/${request.externalModelId.replace(/^\/+/, "")}`;
    const requestPayload = request.params;
    const { status, body } = await this.call(endpoint, request.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const id = dataOf(body).id;
    if (typeof id !== "string" || !id) {
      const message = messageFrom(body, `submit returned no prediction id (HTTP ${status})`);
      throw new ProviderTransportError(message, retryable(status));
    }

    return { externalJobId: id, endpoint, requestPayload, responsePayload: asRecord(body), httpStatus: status };
  }

  async poll(externalJobId: string, apiKey: string): Promise<GenerationOutcome> {
    // Rebuilt from the id rather than followed from the `urls.get` the submit
    // response offers. Following a URL the provider hands back would make every
    // poll a request to an address they choose, and this one is derivable.
    const url = `${this.baseUrl}/api/v3/predictions/${encodeURIComponent(externalJobId)}/result`;
    const { status, body } = await this.call(url, apiKey);
    const record = dataOf(body);
    const responsePayload = asRecord(body);

    if (status >= 400 || Object.keys(record).length === 0) {
      throw new ProviderTransportError(messageFrom(body, `result returned nothing usable (HTTP ${status})`), retryable(status));
    }

    const state = String(record.status ?? "");
    const terminal = TERMINAL[state];
    if (!terminal) return { state: "running", responsePayload };

    if (terminal === "failed") {
      return {
        state: "failed",
        errorCode: state === "timeout" ? "provider_timeout" : state === "cancelled" ? "provider_cancelled" : "provider_failed",
        errorMessage: messageFrom(body, "The provider could not complete this generation."),
        // A refusal is a decision, and retrying the identical prompt gets the
        // identical answer more slowly. A `timeout` upstream is worse than that
        // to retry: their task may still be running, so a second submit pays
        // for two generations the customer asked for once.
        retryable: false,
        responsePayload,
      };
    }

    return {
      state: "succeeded",
      outputs: this.outputsFrom(record),
      // No documented endpoint reports per-prediction cost. Null is the honest
      // answer, and `jobs.provider_cost_usd` falls back to the quote's own
      // estimate so the margin trail is not silently blank for this provider.
      providerUnitsCost: null,
      responsePayload,
    };
  }

  private outputsFrom(record: JsonObject): GenerationOutput[] {
    const outputs = record.outputs;
    if (!Array.isArray(outputs)) return [];
    return outputs
      .filter((url): url is string => typeof url === "string" && url.length > 0)
      .map((url) => describeOutput(url, this.modality));
  }
}
