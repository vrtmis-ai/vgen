import { randomUUID } from "node:crypto";
import { CONTENT_MEDIA_LIMITS, type ContentMedia, type ContentMediaPurpose } from "@vgen/contracts";
import { extensionFor, sniffContentMediaType, type ObjectStore } from "@vgen/adapters";

/**
 * Covers and lesson videos for the effects and academy pages.
 *
 * Stored under `content/` in the one private bucket and served through
 * `GET /api/v1/content/media/:file`, which redirects to a fresh signed URL.
 * That route only ever signs keys under this prefix, so it cannot be pointed
 * at a customer's generation — and a row keeps a link that never expires,
 * where a signed URL written into it would die within the hour.
 *
 * Only an admin with `content.write` reaches `store`. The type is still read
 * from the bytes rather than believed, because the file ends up in a page every
 * visitor opens.
 */

const MB = 1024 * 1024;

export class ContentMediaError extends Error {
  constructor(
    readonly code: "unsupported_media_type" | "file_too_large" | "empty_file",
    message: string,
  ) {
    super(message);
    this.name = "ContentMediaError";
  }
}

/** The largest file a request for this purpose could carry — the multipart ceiling, before the type is known. */
export function contentMediaCeiling(purpose: ContentMediaPurpose): number {
  return purpose === "lesson" ? CONTENT_MEDIA_LIMITS.lessonVideo : Math.max(CONTENT_MEDIA_LIMITS.image, CONTENT_MEDIA_LIMITS.coverVideo);
}

/** Only what `store` names. Anything else in the path is refused before the store is asked. */
const FILE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|webm)$/;

export class ContentMediaService {
  constructor(
    private readonly objects: ObjectStore,
    private readonly urlExpirySeconds = 3600,
  ) {}

  async store(bytes: Uint8Array, purpose: ContentMediaPurpose): Promise<ContentMedia> {
    if (bytes.byteLength === 0) throw new ContentMediaError("empty_file", "That file is empty.");

    const mimeType = sniffContentMediaType(bytes);
    const kind = mimeType?.startsWith("video/") ? "video" : "image";
    if (!mimeType || (purpose === "lesson" && kind !== "video")) {
      throw new ContentMediaError(
        "unsupported_media_type",
        purpose === "lesson"
          ? "A lesson must be an MP4 or WebM video."
          : "A cover must be a JPEG, PNG, WebP or GIF image, or an MP4 or WebM video.",
      );
    }

    const limit =
      kind === "image"
        ? CONTENT_MEDIA_LIMITS.image
        : purpose === "cover"
          ? CONTENT_MEDIA_LIMITS.coverVideo
          : CONTENT_MEDIA_LIMITS.lessonVideo;
    if (bytes.byteLength > limit) {
      throw new ContentMediaError(
        "file_too_large",
        `That file is over the ${limit / MB}MB limit for a ${purpose === "lesson" ? "lesson" : `cover ${kind}`}.`,
      );
    }

    const file = `${randomUUID()}.${extensionFor(mimeType)}`;
    const stored = await this.objects.put(`content/${file}`, bytes, mimeType);
    return { url: `/api/v1/content/media/${file}`, kind, byteSize: stored.byteSize };
  }

  /** Null for anything `store` would not have named. */
  async signedUrl(file: string): Promise<string | null> {
    if (!FILE.test(file)) return null;
    return this.objects.signedUrl(`content/${file}`, this.urlExpirySeconds);
  }
}
