import type { FastifyInstance, FastifyRequest } from "fastify";
import { readSessionToken } from "../auth/cookies";

/**
 * A ceiling on every customer route, not just the two that had one.
 *
 * Sign-in and error telemetry were rate limited from the start, because both
 * are obviously abusable. Everything a customer actually calls — the catalogue,
 * the wallet, the gallery, quotes, job submission — was open at whatever rate
 * the caller could manage, and a load test found the consequence: one session
 * held roughly three hundred requests a second against the pricing endpoint for
 * twenty minutes, wrote 8,933 `quotes` rows, and was never once refused.
 *
 * The cost of that is storage rather than CPU. Nothing deletes an expired
 * quote, so an open write endpoint is a way for a single account to grow the
 * database until it stops. This is the ceiling; migration 0026 is the drain.
 *
 * **Reads and writes get different budgets** because they cost different
 * things. A read is a cached-ish query the browser makes several of per screen;
 * a write prices a generation or inserts a row that outlives the request.
 */
export interface RateLimiter {
  /** Returns null when allowed, or the seconds to wait when not. */
  consume(subject: string): Promise<number | null>;
}

export interface RateLimitBuckets {
  read: RateLimiter;
  write: RateLimiter;
}

/** Paths that must never be limited, whatever else is. */
const EXEMPT = ["/health/", "/api/v1/auth/", "/api/v1/telemetry/", "/api/v1/admin/"];

/**
 * Which budget a request spends from, or null to leave it alone.
 *
 * Auth, telemetry and admin are exempt here because they are limited elsewhere
 * on their own terms — auth by attempt and by identifier, telemetry per IP —
 * and stacking a second ceiling on top would make the effective limit the
 * accident of whichever fired first. Health checks are exempt because a
 * monitoring system that gets a 429 declares an outage.
 */
export function bucketFor(method: string, url: string): keyof RateLimitBuckets | null {
  const path = url.split("?")[0] ?? url;
  if (EXEMPT.some((prefix) => path.startsWith(prefix))) return null;
  if (!path.startsWith("/api/v1/")) return null;
  return method === "GET" || method === "HEAD" ? "read" : "write";
}

/**
 * Who is being counted.
 *
 * The session token first, and the reason is specific to where this product
 * operates: Iranian mobile networks are heavily CGNAT'd, so thousands of
 * unrelated customers share one public address. Keying on IP alone would mean
 * one person on a busy carrier could exhaust the budget for everyone else on
 * it — the limit would fire, correctly by its own logic, on the wrong people.
 *
 * Falling back to IP for anonymous traffic is the right trade the other way:
 * a stranger has no identity to spend, and the routes they can reach are reads.
 *
 * A determined abuser can of course hold several sessions. Each one costs a
 * verified phone number and an SMS code, and *that* path is rate limited
 * already — which is the layer where "how many identities may one person have"
 * belongs, rather than here.
 */
function subjectOf(request: FastifyRequest): string {
  const token = readSessionToken(request);
  return token ? `s:${token}` : `i:${request.ip}`;
}

export interface RateLimitOptions {
  buckets: RateLimitBuckets;
  /** Escape hatch for tests and for a deployment that has no Redis yet. */
  enabled?: boolean;
}

export function registerRateLimits(app: FastifyInstance, options: RateLimitOptions): void {
  if (options.enabled === false) return;

  app.addHook("onRequest", async (request, reply) => {
    const bucket = bucketFor(request.method, request.url);
    if (!bucket) return;

    let waitSeconds: number | null;
    try {
      waitSeconds = await options.buckets[bucket].consume(`${bucket}:${subjectOf(request)}`);
    } catch (error) {
      // Fail open, deliberately. Redis being unreachable is an incident on its
      // own; turning it into a total outage of the shop would be a worse one,
      // and the abuse this guards against is slow rather than instantaneous.
      request.log.warn({ err: error }, "rate limiter unavailable; allowing the request");
      return;
    }

    if (waitSeconds === null) return;
    return reply
      .header("Retry-After", String(waitSeconds))
      .code(429)
      .send({
        error: {
          code: "rate_limited",
          message: "Too many requests. Wait a moment and try again.",
          request_id: request.id,
        },
      });
  });
}

/**
 * The in-process fallback, and the limiter the tests use.
 *
 * Also what a deployment without Redis gets: one bucket per process rather than
 * one per cluster, so the effective limit multiplies by the number of API
 * processes. That is a weaker guarantee than the Redis one and still far better
 * than none.
 */
export function createMemoryRateLimiter(max: number, windowMs: number, now: () => number = Date.now): RateLimiter {
  const windows = new Map<string, { startedAt: number; count: number }>();

  return {
    async consume(subject: string): Promise<number | null> {
      const at = now();
      const current = windows.get(subject);
      if (!current || at - current.startedAt >= windowMs) {
        windows.set(subject, { startedAt: at, count: 1 });
        // Swept on write rather than on a timer: an interval would keep a
        // reference to this map alive for the life of the process and hold the
        // event loop open in tests.
        if (windows.size > 10_000) {
          for (const [key, value] of windows) if (at - value.startedAt >= windowMs) windows.delete(key);
        }
        return null;
      }
      if (current.count >= max) return Math.max(1, Math.ceil((windowMs - (at - current.startedAt)) / 1000));
      current.count += 1;
      return null;
    },
  };
}
