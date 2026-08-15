import { describe, expect, it, vi } from "vitest";
import { RedisFixedWindowRateLimiter } from "./rateLimit";

describe("Redis fixed-window rate limiter", () => {
  it("allows a request below the limit without putting the raw subject in Redis", async () => {
    const evalScript = vi.fn(async (_script: string, _keyCount: number, _key: string, _windowMs: string, _max: string) => [1, 60_000]);
    const client = { eval: evalScript };
    const limiter = new RedisFixedWindowRateLimiter(client, {
      max: 20,
      windowMs: 60_000,
      keyPrefix: "deev:telemetry",
      hashSecret: "test-secret",
    });

    await expect(limiter.consume("203.0.113.7")).resolves.toBeNull();
    expect(evalScript).toHaveBeenCalledOnce();
    const redisKey = evalScript.mock.calls[0]?.[2];
    expect(redisKey).toMatch(/^deev:telemetry:[a-f0-9]{64}$/);
    expect(redisKey).not.toContain("203.0.113.7");
  });

  it("returns the remaining window in whole seconds when Redis rejects a request", async () => {
    const client = { eval: vi.fn(async () => [0, 41_001]) };
    const limiter = new RedisFixedWindowRateLimiter(client, {
      max: 20,
      windowMs: 60_000,
      keyPrefix: "deev:telemetry",
      hashSecret: "test-secret",
    });

    await expect(limiter.consume("203.0.113.7")).resolves.toBe(42);
  });
});
