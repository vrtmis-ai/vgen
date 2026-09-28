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
 * Higgsfield, against documentation crawled on 2026-09-27.
 *
 * UNVERIFIED against a live generation. `scripts/spike-higgsfield.ts` settles it
 * for $0.0032 — one Soul 2 image, the cheapest thing in either catalogue — and
 * until it has run, every `model_routes` row pointing here ships inactive, for
 * the reason `providers/index.ts` gives: two of WaveSpeed's four seeded paths
 * named a model that did not exist, and both were the ones transcribed from a
 * naming convention rather than read off a page.
 *
 * What is known, and how:
 *
 *   - The **published OpenAPI spec describes eight paths** and none of the modes
 *     DEEV sells. The request shapes here come from
 *     `scripts/higgsfield-schemas/`, crawled from each mode's own documentation
 *     page and cross-checked against the schema its playground form renders.
 *     `pnpm higgsfield:schemas --check` re-audits that corpus offline.
 *   - The lifecycle, the status vocabulary, the output shapes and the error table
 *     are documented and were read directly: `concepts/requests`,
 *     `concepts/polling`, `concepts/errors`, `concepts/rate-limits`.
 *
 * Four things shape this file, and three of them are Higgsfield-specific:
 *
 *   - **The mode id is the path**, as on WaveSpeed: `POST /higgsfield/cinema-studio/4.0`
 *     with the params flat in the body. The slashes are real path segments.
 *   - **`Authorization: Key <id>:<secret>`**, not `Bearer`. Both official SDKs
 *     take that pair as one string (`HF_KEY`, `HF_CREDENTIALS`), so one env var
 *     holds it and `provider_credentials.secret_ref` names that var. Nothing
 *     here splits it.
 *   - **`request_id` is at the top level**, not nested under `data`. KIE and
 *     WaveSpeed both nest; assuming a house style here would have read undefined.
 *   - **There is no idempotency key.** The docs say plainly: do not automatically
 *     repeat a generation POST after an ambiguous timeout. That single sentence
 *     is why `submit` classifies its failures the way it does below, and it is
 *     the one place this adapter deliberately disagrees with the other two.
 */

const DEFAULT_BASE_URL = "https://api.higgsfield.ai";

/**
 * The four terminal statuses, and what each one means to us.
 *
 * `queued` and `in_progress` are absent on purpose — they mean "ask again", and
 * so does anything unrecognised, because a status nobody has seen before is not
 * evidence that a generation failed.
 *
 * `nsfw` maps to `content_policy` rather than to a failure of ours: it is a
 * moderation decision, the customer should be told that and not "something went
 * wrong", and Higgsfield does not charge for it. `canceled` carries their
 * spelling, one `l`, and is the string they actually send.
 */
const TERMINAL_FAILURE: Record<string, string> = {
  failed: "provider_failed",
  nsfw: "content_policy",
  canceled: "provider_cancelled",
};

function asRecord(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

/**
 * Their message, if they left one, else ours.
 *
 * Higgsfield uses the FastAPI envelope, so the interesting string is `detail` —
 * which is sometimes a list of validation errors rather than a sentence. A list
 * is summarised rather than stringified into `[object Object]`, because this text
 * reaches the log a support question is answered from.
 */
function messageFrom(body: unknown, fallback: string): string {
  const record = asRecord(body);
  const detail = record.detail ?? record.error ?? record.message;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const fields = detail
      .map((item) => {
        const location = asRecord(item).loc;
        return Array.isArray(location) ? location.filter((part) => typeof part === "string").join(".") : "";
      })
      .filter((name) => name.length > 0);
    return fields.length > 0 ? `rejected: ${fields.join(", ")}` : `rejected ${detail.length} field(s)`;
  }
  return fallback;
}

/**
 * Worth another go: theirs, and temporary. Everything else is ours.
 *
 * 5xx and 429 are the usual pair. `423` is in their table as "model is
 * temporarily blocked", to be retried later. `409` is in no table at all — it
 * came back from `POST /estimate/kling-video/o3/first-last-frame` at 4k on
 * 2026-09-27 reading "This model is temporarily unavailable. Please try again
 * later or contact support", which is the same fact as a 423 with a different
 * number on it. Treated the same way, because a model that is down for an hour
 * must not fail a job permanently.
 *
 * `403` stays terminal despite being recoverable in principle: it means the
 * account is out of credit, and retrying on a schedule does not add funds.
 */
function retryable(status: number): boolean {
  return status >= 500 || status === 429 || status === 409 || status === 423;
}

/**
 * Whether a 400 is the concurrency ceiling rather than a bad request.
 *
 * Higgsfield returns **400** when an account is at its concurrent-generation
 * limit — two on a new account — with no `Retry-After` and no distinguishing
 * code, and their own documentation says the message reads "similar to"
 * `Maximum number of concurrent requests (4) has been reached`. So the message is
 * the only signal there is.
 *
 * The docs also say not to parse human-readable messages to make permanent
 * business decisions, and this does not: it decides whether to *try again later*,
 * which is reversible and costs a queue slot. Getting it wrong in the cautious
 * direction means one wasted retry of a genuinely bad request; getting it wrong
 * the other way means refusing a customer's generation because somebody else's
 * was still running.
 *
 * A semaphore in this file was the first idea and it does not work: the slot
 * would be released when the POST returns, while the generation it started keeps
 * occupying Higgsfield's limit for minutes afterwards. Bounding it properly means
 * counting *unfinished jobs* per provider, which is the worker's business and not
 * an adapter's. Retrying is the honest shape until
 * `provider_credentials.concurrency_limit` is enforced — it is written by the
 * seeders today and read by nothing.
 */
function atConcurrencyLimit(status: number, body: unknown): boolean {
  return status === 400 && /concurrent/i.test(messageFrom(body, ""));
}

/**
 * The parameters Higgsfield does not type as strings, and DEEV's controls do.
 *
 * A catalogue control produces `"5"`, not `5` — `applyParamOverrides` is explicit
 * that params "reach here from catalogue controls, which produce exactly" strings
 * and numbers. For a model routed somewhere else a `map` override could retype
 * them, but a catalogue row served by its own provider **has no route**, so
 * there is no override table to put the coercion in. It belongs here.
 *
 * The three lists are not a guess: they are every non-string property across
 * `scripts/higgsfield-schemas/`. Regenerate them by re-reading that corpus after
 * `pnpm higgsfield:schemas`. Getting this wrong is the expensive kind of wrong —
 * a 422 arrives after the customer's coins are already held.
 */
const INTEGER_PARAMS = new Set(["batch_size", "duration", "seed"]);
const DECIMAL_PARAMS = new Set(["custom_reference_strength", "style_strength"]);
const BOOLEAN_PARAMS = new Set(["enhance_prompt", "generate_audio", "multi_shots"]);

/**
 * Retype what the schemas say is not a string, and touch nothing else.
 *
 * Only a string is ever converted, and only when it converts cleanly: a value
 * that does not parse is passed through untouched so the provider rejects it and
 * says why, rather than this silently sending a `NaN` or a `false` nobody chose.
 */
function typedParams(params: JsonObject): JsonObject {
  const out: JsonObject = { ...params };
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== "string") continue;

    // An empty string means "no choice made" — Higgsfield's way of saying that
    // is to leave the field out entirely, and its own documentation puts it
    // plainly for Cinema Studio: "Omit creative-control fields to let the
    // director choose them automatically; the literal value 'auto' is not
    // accepted for these enum fields."
    //
    // Both halves were checked against the live API on 2026-09-27, because a
    // sentinel that turns out to be a real value is a 422 the customer pays
    // for:
    //     era: "auto"  ->  400  "'auto' is not one of ['1960s', …]"
    //     era: ""      ->  400  "'' is not one of ['1960s', …]"
    //     era omitted  ->  200
    // So the key has to go, and neither string can be sent in its place. The
    // catalogue's "auto" options carry "" for exactly this reason, and the
    // same rule covers Marketing Studio's optional preset.
    if (value === "") {
      delete out[key];
      continue;
    }

    if (INTEGER_PARAMS.has(key) && /^-?\d+$/.test(value.trim())) out[key] = Number.parseInt(value, 10);
    else if (DECIMAL_PARAMS.has(key) && value.trim() !== "" && Number.isFinite(Number(value))) out[key] = Number(value);
    else if (BOOLEAN_PARAMS.has(key) && (value === "true" || value === "false")) out[key] = value === "true";
  }
  return out;
}

/**
 * Trailing slashes off the base URL, one index at a time rather than by regex.
 *
 * `replace(/\/+$/, "")` is what `kie.ts` and `wavespeed.ts` do, and CodeQL
 * flags all three as `js/polynomial-redos` — the engine backtracks across a run
 * of slashes, so a base URL ending in many of them costs quadratic time.
 * Nothing hostile reaches this today, since the URL comes from our own
 * configuration, but the fix is a loop and the alert is real. The other two
 * carry the same line and the same open alerts (#1 and #2); they are somebody
 * else's file to change, not this branch's.
 */
function withoutTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
}

/** The same, at the other end, for the mode id that becomes the path. */
function withoutLeadingSlashes(path: string): string {
  let start = 0;
  while (start < path.length && path[start] === "/") start += 1;
  return path.slice(start);
}

export interface HiggsfieldProviderOptions {
  baseUrl?: string | undefined;
  /** The modality of what is being generated, used to type outputs. */
  modality?: Modality | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  /** Per-request timeout. A provider that never answers must not pin a worker. */
  timeoutMs?: number | undefined;
}

export class HiggsfieldGenerationProvider implements GenerationProvider {
  readonly code = "higgsfield";
  private readonly baseUrl: string;
  private readonly modality: Modality;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: HiggsfieldProviderOptions = {}) {
    this.baseUrl = withoutTrailingSlashes(options.baseUrl ?? DEFAULT_BASE_URL);
    this.modality = options.modality ?? "video";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /**
   * One request. Returns what came back; decides nothing.
   *
   * `answered: false` is the distinction the whole `submit` path rests on — a
   * request that never got a reply is not the same as a request that was
   * refused, and only one of the two is safe to repeat.
   */
  private async call(
    url: string,
    apiKey: string,
    init: RequestInit = {},
  ): Promise<{ answered: true; status: number; body: unknown; correlationId: string | null } | { answered: false; message: string }> {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        signal,
        headers: { Authorization: `Key ${apiKey}`, ...(init.headers ?? {}) },
      });
    } catch (error) {
      return { answered: false, message: error instanceof Error ? error.message : "request failed" };
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
    // Every Higgsfield response carries this, and their support asks for it
    // beside the request_id. Stored with the payload rather than logged apart
    // from it, so the two cannot be separated later.
    return { answered: true, status: response.status, body, correlationId: response.headers.get("x-correlation-id") };
  }

  async submit(request: GenerationRequest): Promise<GenerationSubmission> {
    // The mode id is a path, not a parameter, and its slashes are real segments:
    // `higgsfield/cinema-studio/4.0` must not be percent-encoded as a whole.
    const endpoint = `${this.baseUrl}/${withoutLeadingSlashes(request.externalModelId)}`;
    const requestPayload = typedParams(request.params);
    const answer = await this.call(endpoint, request.apiKey, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload),
    });

    // No answer, so we cannot know whether a generation was created — and there
    // is no idempotency key to make asking again safe. The other two adapters
    // default this to retryable; here that would mean paying twice for one
    // request whenever a socket blips after Higgsfield accepted it. The
    // customer's coins are released either way; what is not recoverable is
    // Higgsfield billing us for a video nobody asked for a second time.
    if (!answer.answered) throw new ProviderTransportError(answer.message, false);

    const { status, body, correlationId } = answer;
    const id = asRecord(body).request_id;
    if (typeof id !== "string" || !id) {
      const message = messageFrom(body, `submit returned no request_id (HTTP ${status})`);
      throw new ProviderTransportError(message, atConcurrencyLimit(status, body) || retryable(status));
    }

    return {
      externalJobId: id,
      endpoint,
      requestPayload,
      responsePayload: { ...asRecord(body), ...(correlationId ? { correlationId } : {}) },
      httpStatus: status,
    };
  }

  async poll(externalJobId: string, apiKey: string): Promise<GenerationOutcome> {
    // Rebuilt from the id rather than followed from the `status_url` the submit
    // response offers. Their docs prefer the returned URL; our interface stores
    // an id and nothing else, and following an address the provider chooses
    // would make every poll a request we did not construct. Same choice, and the
    // same reason, as `wavespeed.ts`.
    const url = `${this.baseUrl}/requests/${encodeURIComponent(externalJobId)}/status`;
    const answer = await this.call(url, apiKey);

    // A poll is safe to repeat — it creates nothing — so unlike submit, no
    // answer means ask again.
    if (!answer.answered) throw new ProviderTransportError(answer.message, true);

    const { status, body, correlationId } = answer;
    const record = asRecord(body);
    const responsePayload: JsonObject = { ...record, ...(correlationId ? { correlationId } : {}) };

    // A status response without a `status` string is not a status response. A
    // proxy's HTML error page reaches here as `{nonJson: "<html>…"}`, which has
    // keys and so would pass a bare emptiness check — and then read as a job
    // still running, which it is no evidence of. Asking again is right; claiming
    // to know the job's state is not.
    const state = typeof record.status === "string" ? record.status : "";
    if (status >= 400) {
      throw new ProviderTransportError(messageFrom(body, `status returned nothing usable (HTTP ${status})`), retryable(status));
    }
    // A 2xx that is not a status response came from something between us and
    // them — a proxy, a CDN error page — so it is retryable whatever the code
    // says. Classifying it by status would call a 200 permanent, which is the
    // one answer it cannot be.
    if (state === "") {
      throw new ProviderTransportError(messageFrom(body, `status ${status} carried no status field`), true);
    }
    if (state === "completed") {
      return {
        state: "succeeded",
        outputs: this.outputsFrom(record),
        // Nothing in the documented status body reports what a request cost.
        // `POST /estimate/<mode>` prices one before it runs, which is how the
        // catalogue is priced, but it is not an answer about this generation.
        // Null is honest, and settlement falls back to the quote's own estimate
        // rather than inventing a number here.
        providerUnitsCost: null,
        responsePayload,
      };
    }

    const errorCode = TERMINAL_FAILURE[state];
    if (!errorCode) return { state: "running", responsePayload };

    return {
      state: "failed",
      errorCode,
      errorMessage: messageFrom(body, "The provider could not complete this generation."),
      // A refusal is a decision, and retrying the identical prompt gets the
      // identical answer more slowly. Higgsfield charges for none of these three
      // and refunds anything it reserved, so the customer is made whole by the
      // refund `settle` already issues.
      retryable: false,
      responsePayload,
    };
  }

  /**
   * The three output shapes, all of which are documented and only one of which
   * any given mode uses.
   *
   * `images` is a list of objects, `video` and `audio` are single objects, and
   * `audios` is a list that repeats what `audio` already said. Read in that
   * order and de-duplicated by URL, so a mode that sends both does not mirror
   * one file twice.
   */
  private outputsFrom(record: JsonObject): GenerationOutput[] {
    const urls: string[] = [];
    const push = (value: unknown): void => {
      const url = asRecord(value).url;
      if (typeof url === "string" && url.length > 0 && !urls.includes(url)) urls.push(url);
    };

    for (const item of Array.isArray(record.images) ? record.images : []) push(item);
    push(record.video);
    push(record.audio);
    for (const item of Array.isArray(record.audios) ? record.audios : []) push(item);

    return urls.map((url) => describeOutput(url, this.modality));
  }
}
