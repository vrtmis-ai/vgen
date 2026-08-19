import { z } from "zod";

/**
 * A file the customer put in, rather than one a generation produced.
 *
 * Uploads go through the API rather than straight to the object store on a
 * presigned URL. That keeps the object store off the public internet entirely
 * — no CORS, no bucket exposed — and it means the bytes can be checked before
 * they are kept: the real type read from the magic bytes rather than believed
 * from a header, a size ceiling enforced where it can be seen, and a sha256
 * that makes re-uploading the same reference free.
 */
export const UploadedAssetSchema = z.object({
  id: z.uuid(),
  url: z.string().min(1),
  kind: z.enum(["image", "video", "audio", "document"]),
  mimeType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  /** True when this exact file was already here and nothing new was stored. */
  deduplicated: z.boolean(),
  urlExpiresAt: z.number().int().nonnegative(),
});

export type UploadedAsset = z.infer<typeof UploadedAssetSchema>;

/** What a reference image may be, and how big. Enforced server-side. */
export const UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const UPLOAD_ACCEPTED_MIME_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
