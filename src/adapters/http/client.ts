import { z } from "zod";

const ErrorBodySchema = z.object({
  error: z
    .object({
      code: z.string().min(1).optional(),
      message: z.string().optional(),
      // snake_case, because that is what the API sends — see the error envelope
      // in apps/api/src/plugins/errors.ts. This read camelCase and so never
      // matched; the x-request-id header was quietly covering for it, which is
      // why nothing looked broken.
      request_id: z.string().min(1).optional(),
    })
    .optional(),
});

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(init: { code: string; message: string; status: number; requestId?: string | undefined; retryAfterMs?: number | undefined }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export interface HttpRequest<T> {
  schema: z.ZodType<T>;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal | undefined;
  headers?: Readonly<Record<string, string>>;
}

export interface HttpClient {
  request<T>(path: string, options: HttpRequest<T>): Promise<T>;
}

export interface HttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  getAccessToken?: (() => Promise<string | null>) | undefined;
}

function statusCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  return "http_error";
}

function retryAfterMs(response: Response): number | undefined {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function createHttpClient({ baseUrl, fetchImpl = fetch, timeoutMs = 15_000, getAccessToken }: HttpClientOptions): HttpClient {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    async request<T>(path: string, options: HttpRequest<T>): Promise<T> {
      if (options.signal?.aborted) {
        throw new ApiError({ code: "request_aborted", message: "Request was cancelled.", status: 0 });
      }

      const controller = new AbortController();
      let timedOut = false;
      const abortFromCaller = () => controller.abort();
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });
      const timer = globalThis.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        let response: Response;
        try {
          const accessToken = await getAccessToken?.();
          response = await fetchImpl(`${root}/${path.replace(/^\/+/, "")}`, {
            method: options.method ?? "GET",
            credentials: "include",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
              ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
              ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
              ...options.headers,
            },
            ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          });
        } catch (error) {
          if (controller.signal.aborted) {
            throw new ApiError({
              code: timedOut ? "request_timeout" : "request_aborted",
              message: timedOut ? "Request timed out." : "Request was cancelled.",
              status: 0,
            });
          }
          throw new ApiError({
            code: "network_error",
            message: error instanceof Error ? error.message : "Network request failed.",
            status: 0,
          });
        }

        const payload = await readJson(response);
        const requestId = response.headers.get("x-request-id") ?? undefined;

        if (!response.ok) {
          const errorBody = ErrorBodySchema.safeParse(payload);
          const details = errorBody.success ? errorBody.data.error : undefined;
          throw new ApiError({
            code: details?.code ?? statusCode(response.status),
            message: details?.message ?? `Request failed with status ${response.status}.`,
            status: response.status,
            ...(details?.request_id || requestId ? { requestId: details?.request_id ?? requestId } : {}),
            ...(response.status === 429 && retryAfterMs(response) !== undefined ? { retryAfterMs: retryAfterMs(response) } : {}),
          });
        }

        const parsed = options.schema.safeParse(payload);
        if (!parsed.success) {
          throw new ApiError({
            code: "invalid_response",
            message: "The server returned an invalid response.",
            status: response.status,
            ...(requestId ? { requestId } : {}),
          });
        }
        return parsed.data;
      } finally {
        globalThis.clearTimeout(timer);
        options.signal?.removeEventListener("abort", abortFromCaller);
      }
    },
  };
}
