import {
  GetObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";

/**
 * Where the files live.
 *
 * One bucket, keys namespaced by what put them there. S3-compatible rather than
 * MinIO-specific because the only thing that changes between MinIO on a laptop
 * and an object store in production is the endpoint — and `forcePathStyle`,
 * which MinIO needs and most hosted stores do not.
 *
 * Reads are served as signed URLs with an expiry, never as public objects. A
 * generation is somebody's, and a bucket set to public-read is a bucket where
 * guessing a key is enough.
 */

export interface StoredObject {
  bucket: string;
  key: string;
  byteSize: number;
  /** Of the bytes as stored. Feeds `assets.sha256`, which is how re-uploads dedupe. */
  sha256: string;
  mimeType: string;
}

export interface ObjectStore {
  put(key: string, body: Uint8Array, mimeType: string): Promise<StoredObject>;
  /** A time-limited GET. The only way anything reads out of here. */
  signedUrl(key: string, expiresInSeconds?: number): Promise<string>;
  delete(key: string): Promise<void>;
  /** Idempotent. Called at startup so a fresh volume is not a runtime surprise. */
  ensureBucket(): Promise<void>;
  readonly bucket: string;
}

export interface S3ObjectStoreOptions {
  bucket: string;
  client: S3Client;
  /** How long a read URL stays valid. Long enough to load a page, not to share. */
  defaultExpirySeconds?: number;
}

export class S3ObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly defaultExpirySeconds: number;

  constructor(options: S3ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client = options.client;
    this.defaultExpirySeconds = options.defaultExpirySeconds ?? 3600;
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      } catch (error) {
        // Two workers starting together both miss the head and both create.
        // The loser's error is the bucket already existing, which is the state
        // it wanted.
        const name = (error as { name?: string }).name ?? "";
        if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") throw error;
      }
    }
  }

  async put(key: string, body: Uint8Array, mimeType: string): Promise<StoredObject> {
    const sha256 = createHash("sha256").update(body).digest("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: mimeType,
        // Not a security control — a bucket this size has no ACLs — but it
        // makes a mistaken re-put visible rather than silent.
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
      }),
    );
    return { bucket: this.bucket, key, byteSize: body.byteLength, sha256, mimeType };
  }

  async signedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds ?? this.defaultExpirySeconds,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export interface CreateObjectStoreOptions extends S3ClientConfig {
  bucket: string;
  defaultExpirySeconds?: number;
}

export function createS3ObjectStore({ bucket, defaultExpirySeconds, ...config }: CreateObjectStoreOptions): S3ObjectStore {
  return new S3ObjectStore({
    bucket,
    // MinIO addresses buckets by path, not by subdomain. Without this every
    // request goes to `http://<bucket>.127.0.0.1:9000`, which resolves nowhere.
    client: new S3Client({ forcePathStyle: true, ...config }),
    ...(defaultExpirySeconds === undefined ? {} : { defaultExpirySeconds }),
  });
}
