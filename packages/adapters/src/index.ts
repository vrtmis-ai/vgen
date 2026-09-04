export interface RedisHealthPort {
  ping(): Promise<void>;
}

export interface StorageHealthPort {
  ping(): Promise<void>;
}

export { RedisHealthAdapter, S3StorageHealthAdapter, createRedisHealthAdapter, createS3StorageHealthAdapter } from "./health";
export { RedisFixedWindowRateLimiter, createRedisFixedWindowRateLimiter } from "./rateLimit";
export type { FixedWindowRateLimitOptions } from "./rateLimit";

export {
  KieGenerationProvider,
  ProviderTransportError,
  WaveSpeedGenerationProvider,
  createGenerationProvider,
  describeOutput,
} from "./providers";
export type {
  GenerationOutcome,
  GenerationOutput,
  GenerationProvider,
  GenerationRequest,
  GenerationSubmission,
  JsonObject,
  JsonValue,
  Modality,
  ProviderOptions,
} from "./providers";

export { S3ObjectStore, assetKindFor, createS3ObjectStore, extensionFor, measure, sniffImageMimeType } from "./storage";
export type { CreateObjectStoreOptions, Measurements, ObjectStore, S3ObjectStoreOptions, StoredObject } from "./storage";
