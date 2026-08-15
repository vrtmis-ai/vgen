export interface RedisHealthPort {
  ping(): Promise<void>;
}

export interface StorageHealthPort {
  ping(): Promise<void>;
}

export { RedisHealthAdapter, S3StorageHealthAdapter, createRedisHealthAdapter, createS3StorageHealthAdapter } from "./health";
export { RedisFixedWindowRateLimiter, createRedisFixedWindowRateLimiter } from "./rateLimit";
export type { FixedWindowRateLimitOptions } from "./rateLimit";
