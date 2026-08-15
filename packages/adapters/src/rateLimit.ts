import { createHmac } from "node:crypto";
import Redis from "ioredis";

const FIXED_WINDOW_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local window_ms = tonumber(ARGV[1])
local max_requests = tonumber(ARGV[2])

if current == 0 then
  redis.call('SET', KEYS[1], 1, 'PX', window_ms)
  return {1, window_ms}
end

local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then
  redis.call('SET', KEYS[1], 1, 'PX', window_ms)
  return {1, window_ms}
end

if current >= max_requests then
  return {0, ttl}
end

redis.call('INCR', KEYS[1])
return {1, ttl}
`;

export interface RedisScriptClient {
  eval(script: string, keyCount: number, key: string, windowMs: string, max: string): Promise<unknown>;
  disconnect?(): void;
}

export interface FixedWindowRateLimitOptions {
  max: number;
  windowMs: number;
  keyPrefix: string;
  hashSecret: string;
}

export class RedisFixedWindowRateLimiter {
  constructor(
    private readonly client: RedisScriptClient,
    private readonly options: FixedWindowRateLimitOptions,
  ) {}

  async consume(subject: string): Promise<number | null> {
    const digest = createHmac("sha256", this.options.hashSecret).update(subject).digest("hex");
    const key = `${this.options.keyPrefix}:${digest}`;
    const result = await this.client.eval(FIXED_WINDOW_SCRIPT, 1, key, String(this.options.windowMs), String(this.options.max));
    if (!Array.isArray(result) || result.length !== 2) throw new Error("Redis returned an invalid rate-limit response");
    return Number(result[0]) === 1 ? null : Math.max(1, Math.ceil(Number(result[1]) / 1000));
  }

  close(): void {
    this.client.disconnect?.();
  }
}

export function createRedisFixedWindowRateLimiter(url: string, options: FixedWindowRateLimitOptions): RedisFixedWindowRateLimiter {
  const redis = new Redis(url, {
    connectTimeout: 2_000,
    commandTimeout: 2_000,
    maxRetriesPerRequest: 1,
  });
  return new RedisFixedWindowRateLimiter(
    {
      eval: (script, keyCount, key, windowMs, max) => redis.eval(script, keyCount, key, windowMs, max),
      disconnect: () => redis.disconnect(),
    },
    options,
  );
}
