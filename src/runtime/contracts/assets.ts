import { z } from "zod";

/**
 * A file the customer put in. Mirrors `UploadedAssetSchema` in
 * `packages/contracts/src/assets.ts`.
 *
 * `deduplicated` is worth surfacing rather than hiding: it says these exact
 * bytes were already here, so nothing was transferred and the id is the one
 * the earlier upload got. A screen can use it to skip a "uploaded!" toast for
 * something that did not need uploading.
 */
export const UploadedAssetSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document"]),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  deduplicated: z.boolean(),
  urlExpiresAt: z.number().int().nonnegative(),
});

export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;

/** Enforced server-side too; these are here so a screen can refuse earlier. */
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const UPLOAD_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
