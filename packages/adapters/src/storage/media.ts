/**
 * What a file actually is, from its first bytes.
 *
 * The browser's `Content-Type` on a multipart part is whatever the browser felt
 * like, and on a hand-rolled request it is whatever the caller typed. Storing
 * that verbatim means a signed URL can later hand somebody an HTML document
 * labelled `image/png`, which is a stored-XSS shape. The magic bytes are the
 * only claim about a file that the file itself makes.
 *
 * Deliberately a short allow-list rather than a general sniffer: these are the
 * formats a reference image may be, and anything else is refused rather than
 * guessed at.
 */

const SIGNATURES: { mime: string; test: (bytes: Uint8Array) => boolean }[] = [
  { mime: "image/png", test: (b) => starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mime: "image/jpeg", test: (b) => starts(b, [0xff, 0xd8, 0xff]) },
  { mime: "image/gif", test: (b) => starts(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mime: "image/webp",
    // RIFF....WEBP — the size field sits between the two markers, so both have
    // to be checked at their own offsets rather than as one run.
    test: (b) => starts(b, [0x52, 0x49, 0x46, 0x46]) && starts(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
];

function starts(bytes: Uint8Array, signature: number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The real type, or null when it is not something we accept. */
export function sniffImageMimeType(bytes: Uint8Array): string | null {
  return SIGNATURES.find((signature) => signature.test(bytes))?.mime ?? null;
}

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
};

/**
 * The extension for a stored key.
 *
 * Keys carry one because an object store is also a thing people open with a
 * file manager, and a directory of extensionless hashes is unreadable. It is
 * decoration: the stored `ContentType` is what any client actually reads.
 */
export function extensionFor(mimeType: string): string {
  return EXTENSIONS[mimeType] ?? "bin";
}

/** `assets.kind`, which has no 'text' — a text output is filed as a document. */
export function assetKindFor(mimeType: string): "image" | "video" | "audio" | "document" {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}
