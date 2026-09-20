import { describeOutput } from "./output";
import {
  ProviderTransportError,
  type GenerationOutcome,
  type GenerationOutput,
  type GenerationProvider,
  type GenerationRequest,
  type GenerationSubmission,
  type JsonObject,
  type JsonValue,
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

/**
 * Veo 3.1's three tiers, still served only by KIE's pre-marketplace endpoint.
 *
 * The marketplace has a single `veo-3-1` whose request schema has no field for
 * choosing Quality, Fast or Lite — which KIE prices eightfold apart — so the tier
 * a customer paid for can only be asked for here. Both paths answer in their
 * own shapes; see `submitVeo` and `pollVeo`.
 */
const LEGACY_VEO = new Set(["veo3", "veo3_fast", "veo3_lite"]);

/**
 * The body KIE is sent, from the settings a job was priced on.
 *
 * `job.params` stays the customer's settings — the price was hashed from them
 * and the gallery reads `params ->> 'prompt'` — so a field KIE names or types
 * differently is changed here, on the way out, and nowhere else. Exported for
 * `scripts/crawl-kie-schemas.ts`, which audits this body rather than the
 * catalogue's names for things.
 */
export function kieRequestBody(model: string, params: JsonObject): JsonObject {
  if (LEGACY_VEO.has(model)) {
    return {
      // Flat, not under `input`, and `duration` is an integer on this endpoint
      // where the catalogue's segment sends a string.
      ...params,
      model,
      ...(params.duration === undefined ? {} : { duration: Number(params.duration) }),
      // Veo refuses a prompt that is not English. Ours are mostly Persian.
      enableTranslation: true,
    };
  }
  let input = params;
  // ElevenLabs reads the script from `text`. Sent as `prompt` it is a task with
  // nothing to say, which KIE refuses after the coins are held.
  if (model.startsWith("elevenlabs/")) {
    const { prompt, ...rest } = params;
    input = { ...rest, text: prompt ?? "" };
  }
  // Gemini TTS takes a cast and a script — `speakers` and `dialogue_turns` —
  // where the catalogue has one voice and a prompt. One speaker, one turn. An
  // empty style or scene is the catalogue's "none" and is not a value the API
  // knows, so it is left out.
  if (model.startsWith("google/") && model.endsWith("-tts")) {
    const { prompt, voice_name, accent, style, pace, scene, ...rest } = params;
    const speaker: Record<string, JsonValue> = { speaker_id: "Speaker 1", voice_name: voice_name ?? "Kore", accent: accent ?? "Neutral" };
    if (style) speaker.style = style;
    if (pace) speaker.pace = pace;
    input = {
      ...rest,
      ...(scene ? { scene } : {}),
      speakers: [speaker],
      dialogue_turns: [{ speaker_id: "Speaker 1", text: prompt ?? "" }],
    };
  }
  // Required, and the catalogue only fills non-custom mode: the prompt is a
  // description, and Suno writes the lyrics from it.
  if (model === "ai-music-api/generate") input = { custom_mode: false, ...input };
  // Kling 3 requires the field, and the catalogue has no control for it: on,
  // the model reads its shots from a `multi_prompt` this screen cannot build.
  if (model === "kling-3.0/video") input = { multi_shots: false, ...input };
  return { model, input };
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
    const veo = LEGACY_VEO.has(request.externalModelId);
    const endpoint = `${this.baseUrl}${veo ? "/api/v1/veo/generate" : "/api/v1/jobs/createTask"}`;
    const requestPayload = kieRequestBody(request.externalModelId, request.params);
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

  async poll(externalJobId: string, apiKey: string, externalModelId?: string): Promise<GenerationOutcome> {
    if (externalModelId !== undefined && LEGACY_VEO.has(externalModelId)) return this.pollVeo(externalJobId, apiKey);
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

  /**
   * The legacy endpoint's status: `successFlag` 0 running, 1 done, 2 failed
   * before starting, 3 failed upstream. No `creditsConsumed` — settlement falls
   * back to the quoted cost, which is what a null here asks for.
   */
  private async pollVeo(externalJobId: string, apiKey: string): Promise<GenerationOutcome> {
    const url = `${this.baseUrl}/api/v1/veo/record-info?taskId=${encodeURIComponent(externalJobId)}`;
    const { status, body } = await this.call(url, apiKey);
    const record = dataOf(body);
    const responsePayload = asRecord(body);

    if (status >= 400 || Object.keys(record).length === 0) {
      throw new ProviderTransportError(`veo record-info returned nothing usable (HTTP ${status})`, status >= 500 || status === 429);
    }

    const flag = Number(record.successFlag);
    if (flag === 1) {
      const urls = asRecord(record.response).resultUrls;
      const outputs = Array.isArray(urls)
        ? urls.filter((url): url is string => typeof url === "string" && url.length > 0).map((url) => describeOutput(url, this.modality))
        : [];
      return { state: "succeeded", outputs, providerUnitsCost: null, responsePayload };
    }
    if (flag === 2 || flag === 3) {
      return {
        state: "failed",
        errorCode: String(record.errorCode ?? "provider_failed"),
        errorMessage: String(record.errorMessage || "The provider could not complete this generation."),
        retryable: false,
        responsePayload,
      };
    }
    return { state: "running", responsePayload };
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
    const result = asRecord(parsed);
    // Suno answers in its own shape, found on a live task: every take under
    // `data`, each with its own `audio_url`, and no `resultUrls` at all. Read
    // the usual way it was a success with nothing in it.
    const urls = Array.isArray(result.resultUrls)
      ? result.resultUrls
      : Array.isArray(result.data)
        ? result.data.map((take) => asRecord(take).audio_url)
        : null;
    if (!urls) return [];
    return urls.filter((url): url is string => typeof url === "string" && url.length > 0).map((url) => describeOutput(url, this.modality));
  }
}
