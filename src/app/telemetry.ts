import { ApiError } from "../adapters/http/client";

export interface CrashReport {
  type: "frontend_crash";
  release: string;
  host: "web";
  route: string;
  code: string;
  requestId?: string | undefined;
  occurredAt: number;
}

export function createCrashReport(
  error: unknown,
  context: { release?: string | undefined; route?: string | undefined; occurredAt?: number | undefined } = {},
): CrashReport {
  const apiError = error instanceof ApiError ? error : null;
  return {
    type: "frontend_crash",
    release: context.release ?? import.meta.env.VITE_APP_RELEASE ?? "development",
    host: "web",
    route: (context.route ?? globalThis.location?.pathname ?? "/").split("?")[0] || "/",
    code: apiError?.code ?? (error instanceof Error ? error.name : "unknown_error"),
    ...(apiError?.requestId ? { requestId: apiError.requestId } : {}),
    occurredAt: context.occurredAt ?? Date.now(),
  };
}

export function reportCrash(error: unknown): void {
  const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl || import.meta.env.VITE_APP_MODE === "demo") return;
  const body = JSON.stringify(createCrashReport(error));
  if (navigator.sendBeacon?.(`${baseUrl}/telemetry/errors`, new Blob([body], { type: "application/json" }))) return;
  void fetch(`${baseUrl}/telemetry/errors`, {
    method: "POST",
    credentials: "include",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body,
  }).catch(() => undefined);
}
