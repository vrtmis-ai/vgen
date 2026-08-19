import type { GalleryPage, GenerationJob } from "@vgen/contracts";
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
}

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

  private async withUrls(record: GenerationRecord): Promise<GenerationJob> {
    const outputs = await Promise.all(record.outputs.map((output) => this.describe(output)));
    return {
      id: record.id,
      status: record.status,
      familyId: record.familyId,
      variantId: record.variantId,
      coins: record.coins,
      prompt: record.prompt,
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
