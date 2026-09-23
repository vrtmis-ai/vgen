/**
 * The one error class every adapter throws.
 *
 * It lives here rather than in the HTTP adapter because demo mode has to throw
 * it too. A screen distinguishes `invite_required` from `otp_invalid` by
 * checking `error instanceof ApiError` and reading `.code` — the pattern the
 * session gate already uses — and if the demo adapter threw a different class,
 * that check would pass in production and silently fail in the mode the screen
 * was built in. Two error classes make the port a lie.
 *
 * Branch on `code`, never on `message`. Codes are the contract with the API;
 * messages are prose and will change.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  /**
   * Whatever the envelope carried beside the code: the fields that failed
   * validation, the count of items blocking a delete. Unknown rather than a
   * shape, because it is per-code — a caller that wants it narrows it against
   * the code it already branched on.
   */
  readonly details: unknown;

  constructor(init: {
    code: string;
    message: string;
    status: number;
    requestId?: string | undefined;
    retryAfterMs?: number | undefined;
    details?: unknown;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.retryAfterMs = init.retryAfterMs;
    this.details = init.details;
  }
}
