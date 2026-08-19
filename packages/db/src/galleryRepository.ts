import type { Sql } from "postgres";
import { microCreditsToCoins } from "@vgen/core";

/**
 * A customer's generations, one shape whether you ask for one or for a page.
 *
 * A gallery item is a job. There was never a second concept — only a second
 * schema — so this serves `GET /gallery` and `GET /generation/jobs/:id` from
 * the same query with a different `where`.
 *
 * Storage keys come back raw rather than as URLs. Signing is an object-store
 * concern and this package has no object store; the application layer above
 * turns a key into a loan of a few minutes. Putting it here would also mean
 * signing every row of a page nobody scrolled to.
 */

export interface StoredOutput {
  assetId: string;
  bucket: string;
  key: string;
  /** Set only while an output still points at the provider rather than at us. */
  externalUrl: string | null;
  kind: "image" | "video" | "audio" | "document";
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface GenerationRecord {
  id: string;
  status: "draft" | "queued" | "running" | "succeeded" | "failed" | "cancelled" | "expired";
  familyId: string;
  variantId: string;
  coins: number;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  outputs: StoredOutput[];
  error?: { code: string; message: string };
}

export interface GalleryQuery {
  cursor?: string | undefined;
  limit?: number | undefined;
  kind?: "image" | "video" | "audio" | undefined;
}

export interface GalleryPageResult {
  items: GenerationRecord[];
  nextCursor?: string;
}

interface RecordRow {
  id: string;
  status: GenerationRecord["status"];
  family_id: string | null;
  variant_id: string | null;
  micro_credits: string;
  prompt: string | null;
  created_at: Date;
  updated_at: Date;
  error_code: string | null;
  error_message: string | null;
  outputs: StoredOutputRow[] | null;
}

interface StoredOutputRow {
  assetId: string;
  bucket: string;
  key: string;
  externalUrl: string | null;
  kind: StoredOutput["kind"];
  mimeType: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

/**
 * `provider_model_id` is the catalogue row the customer picked, which is the
 * right one to name back to them even when a grant had a second provider serve
 * it. Which machine ran it is ours to know.
 *
 * `coins` reads the charge once the job is over and the hold before that: while
 * it runs the held amount is the honest answer, and after it the charge is —
 * which for every failure is zero, because a failure is refunded in full.
 */
const SELECT_RECORD = `
  select
    job.id,
    job.status,
    model.family as family_id,
    model.capabilities -> 'variant' ->> 'id' as variant_id,
    case when job.completed_at is null then job.micro_credits_held else job.micro_credits_charged end as micro_credits,
    job.params ->> 'prompt' as prompt,
    job.created_at,
    job.updated_at,
    job.error_code,
    job.error_message,
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'assetId', asset.id, 'bucket', asset.storage_bucket, 'key', asset.storage_key,
            'externalUrl', case when asset.storage_provider = 'external' then asset.public_url end,
            'kind', asset.kind, 'mimeType', asset.mime_type,
            'width', asset.width, 'height', asset.height, 'durationMs', asset.duration_ms
          )
          order by asset.output_index, asset.created_at
        ),
        '[]'::jsonb
      )
      from assets asset
      where asset.job_id = job.id and asset.origin = 'generated' and asset.deleted_at is null
    ) as outputs
  from jobs job
  left join provider_models model on model.id = job.provider_model_id
`;

function toRecord(row: RecordRow): GenerationRecord {
  return {
    id: row.id,
    status: row.status,
    familyId: row.family_id ?? "unknown",
    variantId: row.variant_id ?? "unknown",
    coins: microCreditsToCoins(Number(row.micro_credits)),
    prompt: row.prompt ?? "",
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
    outputs: (row.outputs ?? []).map((output) => ({ ...output })),
    ...(row.error_code ? { error: { code: row.error_code, message: row.error_message ?? "" } } : {}),
  };
}

export class PostgresGalleryRepository {
  constructor(private readonly sql: Sql) {}

  /** One generation, scoped to its owner — never by id alone. */
  async getForUser(jobId: string, userId: string): Promise<GenerationRecord | null> {
    const [row] = await this.sql<RecordRow[]>`
      ${this.sql.unsafe(SELECT_RECORD)}
      where job.id = ${jobId}
        and job.deleted_at is null
        and job.account_id = (select personal_account_id from users where id = ${userId})
    `;
    return row ? toRecord(row) : null;
  }

  /**
   * A page of the account's generations, newest first.
   *
   * Keyset on the primary key rather than an offset. `jobs.id` is a uuid v7,
   * so it already sorts by creation time — which means the cursor is the id of
   * the last row you saw and needs no second column, and a generation created
   * while somebody is paging cannot shift the page under them the way an
   * offset would.
   *
   * `draft` is excluded because a draft was never submitted, and a gallery of
   * things that did not happen is not a gallery.
   */
  async listForUser(userId: string, query: GalleryQuery = {}): Promise<GalleryPageResult> {
    const limit = Math.max(1, Math.min(60, Math.trunc(query.limit ?? 24)));
    const rows = await this.sql<RecordRow[]>`
      ${this.sql.unsafe(SELECT_RECORD)}
      where job.account_id = (select personal_account_id from users where id = ${userId})
        and job.deleted_at is null
        and job.status <> 'draft'
        ${query.cursor ? this.sql`and job.id < ${query.cursor}` : this.sql``}
        ${
          query.kind
            ? this.sql`and exists (
                select 1 from features feature
                where feature.id = job.feature_id and feature.modality = ${query.kind}
              )`
            : this.sql``
        }
      order by job.id desc
      limit ${limit + 1}
    `;

    // One more than asked for: its existence is the only proof there is a next
    // page, and it is cheaper than a second count query that could disagree.
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toRecord);
    return hasMore && items.length > 0 ? { items, nextCursor: items[items.length - 1]!.id } : { items };
  }
}
