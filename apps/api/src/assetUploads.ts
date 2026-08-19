import { UPLOAD_ACCEPTED_MIME_TYPES, type UploadedAsset } from "@vgen/contracts";
import { assetKindFor, extensionFor, sniffImageMimeType, type ObjectStore } from "@vgen/adapters";
import { createHash } from "node:crypto";
import type { PostgresAssetsRepository } from "@vgen/db";
import type { AssetUploadApplication } from "./routes/assets";
import { UnsupportedUploadError } from "./routes/assets";

/**
 * Keeping a reference image.
 *
 * The order below is the whole design: hash first, ask the database second,
 * store only if the answer is no. Somebody trying four prompts against the same
 * face uploads it four times, and three of those should cost nothing — not just
 * no row, but no transfer and no object.
 *
 * The declared content type is used for exactly nothing. What is stored is what
 * the bytes say they are, because the header is written by whoever is calling
 * and a signed URL later hands the file back with whatever type we recorded.
 */
export class AssetUploadService implements AssetUploadApplication {
  constructor(
    private readonly assets: PostgresAssetsRepository,
    private readonly store: ObjectStore,
    private readonly urlExpirySeconds = 3600,
  ) {}

  async upload(input: { userId: string; bytes: Uint8Array; declaredMimeType: string }): Promise<UploadedAsset | null> {
    if (input.bytes.byteLength === 0) throw new UnsupportedUploadError("empty_file", "That file is empty.");

    const mimeType = sniffImageMimeType(input.bytes);
    if (!mimeType) {
      throw new UnsupportedUploadError(
        "unsupported_media_type",
        `Reference images must be one of: ${UPLOAD_ACCEPTED_MIME_TYPES.join(", ")}.`,
      );
    }

    const accountId = await this.assets.accountFor(input.userId);
    if (!accountId) return null;

    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const existing = await this.assets.findByHash(accountId, sha256);
    if (existing) return this.describe(existing.id, existing.key, existing.kind, existing.mimeType, existing.byteSize, true);

    // Scoped by account, so two customers uploading the same stock photo get
    // their own object. A shared key would be cheaper and would also mean one
    // account's delete reaching into another's gallery.
    const key = `uploads/${accountId}/${sha256}.${extensionFor(mimeType)}`;
    const stored = await this.store.put(key, input.bytes, mimeType);
    const record = await this.assets.record({
      accountId,
      createdBy: input.userId,
      kind: assetKindFor(mimeType),
      bucket: stored.bucket,
      key: stored.key,
      mimeType,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
    });

    return this.describe(record.id, record.key, record.kind, mimeType, stored.byteSize, false);
  }

  private async describe(
    id: string,
    key: string,
    kind: UploadedAsset["kind"],
    mimeType: string,
    byteSize: number,
    deduplicated: boolean,
  ): Promise<UploadedAsset> {
    return {
      id,
      url: await this.store.signedUrl(key, this.urlExpirySeconds),
      kind,
      mimeType,
      byteSize,
      deduplicated,
      urlExpiresAt: Date.now() + this.urlExpirySeconds * 1000,
    };
  }
}
