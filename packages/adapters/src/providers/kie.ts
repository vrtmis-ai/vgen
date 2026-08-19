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
 * KIE, against the shapes `scripts/spike-kie.ts` verified on the live API.
 *
 * Every quirk handled below is one the spike found rather than one the docs
 * state:
 *
 *   - a 200 can carry a failure. The task id is inside `data`, and its absence
 *     is the error, not the status line.
 *   - `resultJson` is a JSON *string* nested inside the JSON body, so it needs
 *     parsing a second time, and a provider that changes its mind about that
 *     must not take the worker down with a throw.
 *   - `creditsConsumed` is reported per task and matched what the balance
 *     actually dropped by, which is why settlement can record it.
 *
 * The API key arrives per call rather than in the constructor: the same
 * provider is served by a pool of credentials, and which one is used is a
 * decision made per job by the pool picker, not once at startup.
 */

const DEFAULT_BASE_URL = "https://api.kie.ai";

/** States seen in practice. Anything unrecognised is treated as still running. */
const TERMINAL: Record<string, "succeeded" | "failed"> = { success: "succeeded", fail: "failed" };

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

/** KIE nests the real answer under `data` on every endpoint. */
function dataOf(body: unknown): JsonObject {
  return asRecord(asRecord(body).data);
}

export interface KieProviderOptions {
  baseUrl?: string | undefined;
  /** The modality of what is being generated, used to type outputs. */
  modality?: Modality | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  /** Per-request timeout. A provider that never answers must not pin a worker. */
  timeoutMs?: number | undefined;
}

export class KieGenerationProvider implements GenerationProvider {
  readonly code = "kie";
  private readonly baseUrl: string;
  private readonly modality: Modality;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: KieProviderOptions = {}) {
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
      // Never got an answer. Retryable by default: the alternative is refusing
      // a customer's generation because a socket blipped.
      throw new ProviderTransportError(error instanceof Error ? error.message : "request failed");
    }
    const text = await response.text().catch(() => "");
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Kept as-is rather than thrown on: an HTML error page is a fact worth
      // storing in job_attempts.response_payload, not a parser crash.
      body = { nonJson: text.slice(0, 4_000) };
    }
    return { status: response.status, body };
  }

  async submit(request: GenerationRequest): Promise<GenerationSubmission> {
    const endpoint = `${this.baseUrl}/api/v1/jobs/createTask`;
    const requestPayload = { model: request.externalModelId, input: request.params };
    const { status, body } = await this.call(endpoint, request.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    const taskId = dataOf(body).taskId;
    if (typeof taskId !== "string" || !taskId) {
      const message = String(asRecord(body).msg ?? asRecord(body).message ?? `createTask returned no task id (HTTP ${status})`);
      // 5xx is theirs and worth retrying; 4xx is ours and will be rejected
      // identically on every attempt.
      throw new ProviderTransportError(message, status >= 500 || status === 429);
    }

    return { externalJobId: taskId, endpoint, requestPayload, responsePayload: asRecord(body), httpStatus: status };
  }

  async poll(externalJobId: string, apiKey: string): Promise<GenerationOutcome> {
    const url = `${this.baseUrl}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(externalJobId)}`;
    const { status, body } = await this.call(url, apiKey);
    const record = dataOf(body);
    const responsePayload = asRecord(body);

    if (status >= 400 || Object.keys(record).length === 0) {
      throw new ProviderTransportError(`recordInfo returned nothing usable (HTTP ${status})`, status >= 500 || status === 429);
    }

    const terminal = TERMINAL[String(record.state ?? "")];
    if (!terminal) return { state: "running", responsePayload };

    if (terminal === "failed") {
      return {
        state: "failed",
        errorCode: String(record.failCode ?? "provider_failed"),
        errorMessage: String(record.failMsg ?? "The provider could not complete this generation."),
        // A refusal is a decision, not a hiccup. Retrying the identical
        // prompt gets the identical answer, slower.
        retryable: false,
        responsePayload,
      };
    }

    return {
      state: "succeeded",
      outputs: this.outputsFrom(record),
      providerUnitsCost: typeof record.creditsConsumed === "number" ? record.creditsConsumed : null,
      responsePayload,
    };
  }

  private outputsFrom(record: JsonObject): GenerationOutput[] {
    let parsed: unknown = record.resultJson;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = null;
      }
    }
    const urls = asRecord(parsed).resultUrls;
    if (!Array.isArray(urls)) return [];
    return urls.filter((url): url is string => typeof url === "string" && url.length > 0).map((url) => describeOutput(url, this.modality));
  }
}
