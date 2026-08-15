import { ListBucketsCommand, S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
import Redis from "ioredis";

export interface RedisHealthClient {
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  disconnect(): void;
}

export interface S3HealthClient {
  send(command: ListBucketsCommand): Promise<unknown>;
}

export class RedisHealthAdapter {
  constructor(private readonly createClient: () => RedisHealthClient) {}

  async ping(): Promise<void> {
    const client = this.createClient();
    try {
      await client.connect();
      const response = await client.ping();
      if (response !== "PONG") throw new Error(`Redis returned an unexpected response: ${response}`);
    } finally {
      client.disconnect();
    }
  }
}

export class S3StorageHealthAdapter {
  constructor(private readonly client: S3HealthClient) {}

  async ping(): Promise<void> {
    await this.client.send(new ListBucketsCommand({}));
  }
}

export function createRedisHealthAdapter(url: string): RedisHealthAdapter {
  return new RedisHealthAdapter(
    () =>
      new Redis(url, {
        lazyConnect: true,
        connectTimeout: 2_000,
        commandTimeout: 2_000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      }),
  );
}

export function createS3StorageHealthAdapter(config: S3ClientConfig): S3StorageHealthAdapter {
  return new S3StorageHealthAdapter(new S3Client(config));
}
