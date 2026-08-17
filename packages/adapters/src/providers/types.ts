/**
 * What a generation provider has to be able to do, and nothing else.
 *
 * Two calls, because every provider we have looked at is asynchronous: you post
 * a task and get an id, then you ask about that id until it stops changing.
 * Synchronous providers fit by resolving immediately on `poll`, so the shape
 * does not need a second branch for them.
 *
 * Everything a provider returns is also everything `job_attempts` records —
 * the request bytes, the response bytes, the HTTP status, what it cost. That
 * table exists so a charge can be explained six months later, and an adapter
 * that summarises instead of returning what it saw makes that impossible.
 */

export type Modality = "image" | "video" | "audio" | "text";

/**
 * Everything crossing this boundary is JSON, and typed as JSON rather than as
 * `unknown` so it can go straight into a jsonb column. Both ends are already
 * `JSON.parse` output on one side and `JSON.stringify` input on the other; the
 * nested members are readonly so this stays interchangeable with the same
 * shape in `@vgen/db`, which is where these payloads are stored.
 */
export type JsonValue = null | string | number | boolean | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = Record<string, JsonValue>;

export interface GenerationRequest {
  /** The exact string the provider expects — provider_models.external_model_id. */
  externalModelId: string;
  /** The resolved settings, already validated and priced. */
  params: JsonObject;
  /** Resolved from provider_credentials.secret_ref by the caller, never stored. */
  apiKey: string;
}

export interface GenerationSubmission {
  /** Their task id. What poll() takes, and what a webhook would match on. */
  externalJobId: string;
  endpoint: string;
  requestPayload: JsonObject;
  responsePayload: JsonObject;
  httpStatus: number;
}

export interface GenerationOutput {
  url: string;
  kind: Modality;
  mimeType: string;
}

export type GenerationOutcome =
  | { state: "running"; responsePayload: JsonObject }
  | {
      state: "succeeded";
      outputs: GenerationOutput[];
      /** In the provider's own unit — KIE credits, useapi requests. Null if unreported. */
      providerUnitsCost: number | null;
      responsePayload: JsonObject;
    }
  | {
      state: "failed";
      errorCode: string;
      errorMessage: string;
      /**
       * Whether trying again could plausibly work. A 500 or a timeout is worth
       * another attempt; a rejected prompt will be rejected identically forever,
       * and retrying it five times just makes the customer wait longer to be
       * told no.
       */
      retryable: boolean;
      responsePayload: JsonObject;
    };

/**
 * Thrown for transport failures — the request never got an answer.
 *
 * Distinct from a `failed` outcome, which is the provider answering that it
 * will not do the thing. This one means we do not know whether it did.
 */
export class ProviderTransportError extends Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
    this.name = "ProviderTransportError";
  }
}

export interface GenerationProvider {
  /** Matches providers.code, which is how the runner finds this adapter. */
  readonly code: string;
  submit(request: GenerationRequest): Promise<GenerationSubmission>;
  poll(externalJobId: string, apiKey: string): Promise<GenerationOutcome>;
}
