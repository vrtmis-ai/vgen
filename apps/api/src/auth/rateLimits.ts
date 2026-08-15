import { createRedisFixedWindowRateLimiter } from "@vgen/adapters";
import type { Sql } from "postgres";
import type { AuthRateLimiters } from "../routes/auth";

interface Policy {
  window_seconds: number;
  max_requests: number;
}

/**
 * Builds the auth limiters from the policies stored in Postgres.
 *
 * The split is deliberate and predates this file: `rate_limit_policies` holds
 * the numbers, so an operator can loosen OTP sending during a campaign without
 * a deploy, and Redis holds the counters, because a counter incremented on
 * every request does not belong in a table that is also the audit record.
 *
 * Falls back to the seeded defaults when a policy row is missing, so a deleted
 * row degrades to "limited" rather than to "unlimited".
 */
export async function createAuthRateLimiters(
  sql: Sql,
  redisUrl: string,
  hashSecret: string,
): Promise<AuthRateLimiters & { close: () => void }> {
  const rows = await sql<({ code: string; scope: string } & Policy)[]>`
    select code, scope, window_seconds, max_requests
    from rate_limit_policies
    where is_active and plan_id is null
  `;
  const byKey = new Map(rows.map((row) => [`${row.code}:${row.scope}`, row]));

  const limiter = (code: string, scope: string, fallback: Policy) => {
    const policy = byKey.get(`${code}:${scope}`) ?? fallback;
    return createRedisFixedWindowRateLimiter(redisUrl, {
      max: policy.max_requests,
      windowMs: policy.window_seconds * 1000,
      // Versioned, so changing what a subject means does not inherit counts
      // keyed on the old meaning.
      keyPrefix: `deev:rate-limit:${code}:${scope}:v1`,
      hashSecret,
    });
  };

  // The fallbacks mirror the rows seeded in 0005_security.sql.
  const limiters = {
    otpSendPerPhone: limiter("otp.send", "phone", { window_seconds: 3600, max_requests: 5 }),
    otpSendPerIp: limiter("otp.send", "ip", { window_seconds: 3600, max_requests: 15 }),
    otpVerifyPerPhone: limiter("otp.verify", "phone", { window_seconds: 900, max_requests: 10 }),
    loginPerAccount: limiter("login", "user", { window_seconds: 900, max_requests: 10 }),
    loginPerIp: limiter("login", "ip", { window_seconds: 900, max_requests: 50 }),
  };

  return {
    ...limiters,
    close: () => {
      for (const value of Object.values(limiters)) value.close();
    },
  };
}
