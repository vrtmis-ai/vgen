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
  /**
   * Signs read URLs, when the store answers to a different name outside.
   *
   * Presigning is arithmetic, not a request: nothing is contacted, and the
   * endpoint only decides what the resulting URL says. So a deployment whose
   * store is private on the inside and published on the outside signs with
   * this one and does everything else with `client`. Defaults to `client`.
   */
  signingClient?: S3Client;
  /** How long a read URL stays valid. Long enough to load a page, not to share. */
  defaultExpirySeconds?: number;
}

export class S3ObjectStore implements ObjectStore {
  readonly bucket: string;
  private readonly client: S3Client;
  private readonly signingClient: S3Client;
  private readonly defaultExpirySeconds: number;

  constructor(options: S3ObjectStoreOptions) {
    this.bucket = options.bucket;
    this.client = options.client;
    this.signingClient = options.signingClient ?? options.client;
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
    return getSignedUrl(this.signingClient, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSeconds ?? this.defaultExpirySeconds,
    });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

export interface CreateObjectStoreOptions extends S3ClientConfig {
  bucket: string;
  /**
   * The name the store answers to from outside this network.
   *
   * Two callers read from here and neither is on it. The browser is handed a
   * signed URL for every gallery item; the generation PROVIDER is handed one
   * for every reference image and fetches it from its own servers. Both need a
   * public address, which is why a signed URL cannot simply say `minio:9000`.
   *
   * Setting `endpoint` to the public name instead would work and is what a
   * single-variable deployment ends up doing, at two costs: every upload and
   * every mirrored output leaves the host and comes back through the proxy,
   * and the store's write API has to be publicly reachable to allow it. With
   * this split the endpoint stays private, only reads are published, and the
   * proxy in front of the public name can refuse anything but GET.
   *
   * Unset — the local default — means the store has one name and signs with it.
   */
  publicEndpoint?: string | undefined;
  defaultExpirySeconds?: number;
}

export function createS3ObjectStore({ bucket, defaultExpirySeconds, publicEndpoint, ...config }: CreateObjectStoreOptions): S3ObjectStore {
  // MinIO addresses buckets by path, not by subdomain. Without this every
  // request goes to `http://<bucket>.127.0.0.1:9000`, which resolves nowhere.
  const client = new S3Client({ forcePathStyle: true, ...config });
  return new S3ObjectStore({
    bucket,
    client,
    ...(publicEndpoint ? { signingClient: new S3Client({ forcePathStyle: true, ...config, endpoint: publicEndpoint }) } : {}),
    ...(defaultExpirySeconds === undefined ? {} : { defaultExpirySeconds }),
  });
}
