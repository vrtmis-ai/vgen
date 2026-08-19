import { UPLOAD_ACCEPTED_MIME_TYPES, UPLOAD_MAX_BYTES, type UploadedAsset } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";
import type { CustomerSessionApplication } from "./session";

/**
 * Reference images, on their way in.
 *
 * The bytes come through this process rather than straight to the object store
 * on a presigned URL, and that is a deliberate trade. It costs a round trip
 * through Node for a few megabytes. It buys four things a presigned PUT cannot
 * have:
 *
 *   - the object store never has to be reachable from a browser, so it stays on
 *     a private network with no CORS and no public port;
 *   - the size ceiling is enforced where it can be seen, not encoded in a
 *     signing policy nobody re-reads;
 *   - the type is read from the file's own magic bytes rather than believed
 *     from a header the caller wrote;
 *   - the sha256 is computed here, which is what makes re-uploading the same
 *     reference free.
 */

export interface AssetUploadApplication {
  /**
   * Store these bytes for this user, or hand back the asset that already holds
   * them. Returns null when the caller has no account to store them against.
   */
  upload(input: { userId: string; bytes: Uint8Array; declaredMimeType: string }): Promise<UploadedAsset | null>;
}

export class UnsupportedUploadError extends Error {
  constructor(
    readonly code: "unsupported_media_type" | "file_too_large" | "empty_file",
    message: string,
  ) {
    super(message);
    this.name = "UnsupportedUploadError";
  }
}

const REFUSAL_STATUS: Record<UnsupportedUploadError["code"], number> = {
  unsupported_media_type: 415,
  file_too_large: 413,
  empty_file: 400,
};

export function registerAssetUploadRoute(app: FastifyInstance, sessions: CustomerSessionApplication, assets: AssetUploadApplication): void {
  app.post("/api/v1/assets", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    // `isMultipart` comes from @fastify/multipart. Checked rather than assumed
    // so a JSON body gets a clear 415 instead of an internal error.
    if (!request.isMultipart()) {
      return reply.code(415).send({ error: { code: "expected_multipart", message: "Send the file as multipart/form-data." } });
    }

    const file = await request.file({ limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });
    if (!file) {
      return reply.code(400).send({ error: { code: "no_file", message: "No file was attached." } });
    }

    const bytes = await file.toBuffer();
    // @fastify/multipart truncates at the limit and sets this rather than
    // throwing, so without the check a 15MB-and-one-byte upload would be
    // silently stored as a corrupt 15MB file.
    if (file.file.truncated) {
      return reply
        .code(413)
        .send({ error: { code: "file_too_large", message: `Reference images must be under ${UPLOAD_MAX_BYTES / (1024 * 1024)}MB.` } });
    }

    try {
      const uploaded = await assets.upload({
        userId: session.user.id,
        bytes: new Uint8Array(bytes),
        declaredMimeType: file.mimetype,
      });
      if (!uploaded) {
        return reply.code(403).send({ error: { code: "no_account", message: "This user has no account to store files against." } });
      }
      return reply.code(uploaded.deduplicated ? 200 : 201).send(uploaded);
    } catch (error) {
      if (error instanceof UnsupportedUploadError) {
        return reply.code(REFUSAL_STATUS[error.code]).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });
}

export { UPLOAD_ACCEPTED_MIME_TYPES, UPLOAD_MAX_BYTES };
