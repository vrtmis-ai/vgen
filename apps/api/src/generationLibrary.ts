import type { GalleryPage, GenerationJob, JobReference } from "@vgen/contracts";
import type { ObjectStore } from "@vgen/adapters";
import type { GalleryQuery, GenerationRecord, PostgresGalleryRepository, StoredOutput } from "@vgen/db";

/**
 * A customer's generations, with readable links attached.
 *
 * The repository knows where a file is; this knows how to let somebody look at
 * it for the next hour. Keeping those apart is why the database package has no
 * object store in it, and why a page of thirty rows does not sign thirty URLs
 * for images nobody scrolled to — signing happens here, once, on the rows
 * actually being returned.
 *
 * Every link expires. A generation belongs to whoever paid for it, and a bucket
 * that serves anything to anyone who knows a key is not access control.
 */

export interface GenerationLibraryApplication {
  get(jobId: string, userId: string): Promise<GenerationJob | null>;
  list(userId: string, query: GalleryQuery): Promise<GalleryPage>;
  /** A link that saves the file instead of displaying it. Null if there is no such output. */
  downloadUrl(jobId: string, userId: string, index: number): Promise<string | null>;
  /** The files a generation ran against, signed for preview. Empty if it had none. */
  references(jobId: string, userId: string): Promise<JobReference[]>;
  /** Take a settled generation off the account's wall. */
  remove(jobId: string, userId: string): Promise<"removed" | "still_running" | "not_found">;
}

/**
 * The extension for a stored file, from what it actually is.
 *
 * Read from the mime type rather than from the generation's `kind`, because
 * `kind` is a category ("video") and a filename needs the container the bytes
 * are actually in. Unknown types get no extension rather than a wrong one —
 * every operating system handles a missing extension better than a lying one.
 */
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

export class GenerationLibraryService implements GenerationLibraryApplication {
  constructor(
    private readonly gallery: PostgresGalleryRepository,
    private readonly store: ObjectStore,
    private readonly expirySeconds = 3600,
  ) {}

  async get(jobId: string, userId: string): Promise<GenerationJob | null> {
    const record = await this.gallery.getForUser(jobId, userId);
    return record ? this.withUrls(record) : null;
  }

  async list(userId: string, query: GalleryQuery): Promise<GalleryPage> {
    const page = await this.gallery.listForUser(userId, query);
    const items = await Promise.all(page.items.map((record) => this.withUrls(record)));
    return page.nextCursor ? { items, nextCursor: page.nextCursor } : { items };
  }

  /**
   * The same object, signed to arrive as a file.
   *
   * Separate from `describe()` on purpose: the inline URL it produces is what
   * an `<img src>` uses, and asking the store for `Content-Disposition:
   * attachment` there would stop every picture rendering. Nothing signs twice
   * per output on a gallery read, because this is only reached when somebody
   * presses the button.
   */
  async downloadUrl(jobId: string, userId: string, index: number): Promise<string | null> {
    const record = await this.gallery.getForUser(jobId, userId);
    const output = record?.outputs[index];
    if (!record || !output) return null;
    // A pre-mirroring row still lives on the provider's host, where we can ask
    // for nothing. Better a link that opens than no link at all.
    if (output.externalUrl) return output.externalUrl;
    const extension = EXTENSIONS[output.mimeType];
    // Numbered past the first: a Suno job is two takes, and two files of one
    // name land as "vgen-….mp3" and "vgen-… (1).mp3".
    const filename = `vgen-${record.id}${index > 0 ? `-${index + 1}` : ""}${extension ? `.${extension}` : ""}`;
    return this.store.signedUrl(output.key, this.expirySeconds, { downloadAs: filename });
  }

  /**
   * The files this generation was run against, ready to be shown.
   *
   * Signed here and not on the job, for the reason `downloadUrl` is not on the
   * output: a page of thirty generations would sign every reference of every
   * one of them to fill a form nobody has opened yet.
   */
  async references(jobId: string, userId: string): Promise<JobReference[]> {
    const stored = await this.gallery.referencesForUser(jobId, userId);
    return Promise.all(
      stored.map(async (reference) => ({
        slot: reference.slot,
        assetId: reference.assetId,
        url: await this.store.signedUrl(reference.key, this.expirySeconds),
        kind: reference.kind,
      })),
    );
  }

  /**
   * Straight through to the repository, which owns the rules about which
   * generations may go. Here for the same reason `get` and `list` are: routes
   * talk to this, never to `@vgen/db`.
   */
  remove(jobId: string, userId: string): Promise<"removed" | "still_running" | "not_found"> {
    return this.gallery.removeForUser(jobId, userId);
  }

  private async withUrls(record: GenerationRecord): Promise<GenerationJob> {
    const outputs = await Promise.all(record.outputs.map((output) => this.describe(output)));
    return {
      id: record.id,
      status: record.status,
      familyId: record.familyId,
      variantId: record.variantId,
      coins: record.coins,
      prompt: record.prompt,
      params: record.params,
      referenceAssetIds: record.referenceAssetIds,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      outputs,
      // Null rather than a time in the past when there is nothing to expire:
      // a client polling a queued job should not be told to refresh links it
      // does not have.
      urlsExpireAt: outputs.length > 0 ? Date.now() + this.expirySeconds * 1000 : null,
      ...(record.error ? { error: record.error } : {}),
    };
  }

  private async describe(output: StoredOutput): Promise<GenerationJob["outputs"][number]> {
    // `externalUrl` is set only on rows written before outputs were mirrored,
    // where the file never left the provider. Those links are already dead or
    // dying; handing one over is still better than handing over nothing, and it
    // keeps a pre-Phase-H gallery readable rather than blank.
    const url = output.externalUrl ?? (await this.store.signedUrl(output.key, this.expirySeconds));
    return {
      assetId: output.assetId,
      url,
      kind: output.kind,
      mimeType: output.mimeType,
      width: output.width,
      height: output.height,
      durationMs: output.durationMs,
    };
  }
}
