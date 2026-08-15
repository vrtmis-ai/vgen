import { FrontendCrashReportSchema, type FrontendCrashReport } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";

export interface FrontendTelemetryApplication {
  record(report: FrontendCrashReport): Promise<string>;
}

export interface TelemetryRateLimiter {
  consume(subject: string): Promise<number | null>;
}

export interface TelemetryRateLimitOptions {
  max?: number | undefined;
  windowMs?: number | undefined;
  now?: (() => number) | undefined;
}

function createRateLimiter(options: TelemetryRateLimitOptions = {}) {
  const max = options.max ?? 20;
  const windowMs = options.windowMs ?? 60_000;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { startedAt: number; count: number }>();

  return (key: string): number | null => {
    const at = now();
    const current = windows.get(key);
    if (!current || at - current.startedAt >= windowMs) {
      windows.set(key, { startedAt: at, count: 1 });
      return null;
    }
    if (current.count >= max) return Math.max(1, Math.ceil((windowMs - (at - current.startedAt)) / 1000));
    current.count += 1;
    return null;
  };
}

export function registerFrontendTelemetryRoute(
  app: FastifyInstance,
  telemetry: FrontendTelemetryApplication,
  rateLimitOptions?: TelemetryRateLimitOptions,
  sharedRateLimiter?: TelemetryRateLimiter,
): void {
  const localRetryAfter = createRateLimiter(rateLimitOptions);
  app.post("/api/v1/telemetry/errors", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    let waitSeconds: number | null;
    try {
      waitSeconds = sharedRateLimiter ? await sharedRateLimiter.consume(request.ip) : localRetryAfter(request.ip);
    } catch (error) {
      request.log.warn({ err: error }, "shared telemetry rate limiter unavailable; using local fallback");
      waitSeconds = localRetryAfter(request.ip);
    }
    if (waitSeconds !== null) {
      return reply
        .header("Retry-After", String(waitSeconds))
        .code(429)
        .send({ error: { code: "rate_limited", message: "Too many error reports.", request_id: request.id } });
    }
    const report = FrontendCrashReportSchema.parse(request.body);
    const reportId = await telemetry.record(report);
    return reply.code(202).send({ accepted: true, reportId });
  });
}
