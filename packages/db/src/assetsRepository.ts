import type { Sql } from "postgres";

/**
 * Files the customer put in, as opposed to files a generation produced.
 *
 * The only interesting thing here is the deduplication. A reference image gets
 * re-uploaded constantly — somebody tries four variants of the same prompt
 * against the same face — and each one is a few megabytes into an object store
 * we pay for. Keying on the sha256 of the bytes makes the second upload free
 * and, more usefully, gives the same asset id back, so a job's inputs stay
 * comparable across attempts.
 *
 * Scoped per account rather than globally. A global dedupe would be cheaper
 * still and would also mean one customer's upload silently becoming another
 * customer's asset id, which is a data-leak shape not a saving.
 */

export interface UploadRecord {
  accountId: string;
  createdBy: string;
  kind: "image" | "video" | "audio" | "document";
  bucket: string;
  key: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
}

export interface StoredUpload {
  id: string;
  bucket: string;
  key: string;
  kind: UploadRecord["kind"];
  mimeType: string;
  byteSize: number;
  /** True when these exact bytes were already here and nothing new was stored. */
  deduplicated: boolean;
}

export class PostgresAssetsRepository {
  constructor(private readonly sql: Sql) {}

  /** The account this user spends from, or null if there is no such user. */
  async accountFor(userId: string): Promise<string | null> {
    const [row] = await this.sql<{ personal_account_id: string | null }[]>`
      select personal_account_id from users where id = ${userId} limit 1
    `;
    return row?.personal_account_id ?? null;
  }

  /**
   * An existing upload with these bytes, if this account already has one.
   *
   * Asked *before* anything is written to the object store, which is the point
   * — the saving is the upload, not the row.
   */
  async findByHash(accountId: string, sha256: string): Promise<StoredUpload | null> {
    const [row] = await this.sql<
      { id: string; storage_bucket: string; storage_key: string; kind: StoredUpload["kind"]; mime_type: string; byte_size: string | null }[]
    >`
      select id, storage_bucket, storage_key, kind, mime_type, byte_size
      from assets
      where account_id = ${accountId} and sha256 = ${sha256} and origin = 'upload' and deleted_at is null
      limit 1
    `;
    if (!row) return null;
    return {
      id: row.id,
      bucket: row.storage_bucket,
      key: row.storage_key,
      kind: row.kind,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size ?? 0),
      deduplicated: true,
    };
  }

  async record(upload: UploadRecord): Promise<StoredUpload> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into assets (
        account_id, created_by, kind, origin, storage_provider, storage_bucket, storage_key,
        mime_type, byte_size, sha256, moderation_state, visibility
      ) values (
        ${upload.accountId}, ${upload.createdBy}, ${upload.kind}, 'upload', 's3', ${upload.bucket}, ${upload.key},
        ${upload.mimeType}, ${upload.byteSize}, ${upload.sha256}, 'pending', 'private'
      )
      -- The key already contains the account and the hash, so a collision is
      -- the same account storing the same bytes twice in a race. Both callers
      -- should get the row rather than one getting an error.
      on conflict (storage_bucket, storage_key) do update set deleted_at = null
      returning id
    `;
    return {
      id: row!.id,
      bucket: upload.bucket,
      key: upload.key,
      kind: upload.kind,
      mimeType: upload.mimeType,
      byteSize: upload.byteSize,
      deduplicated: false,
    };
  }
}
