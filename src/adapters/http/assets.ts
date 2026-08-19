import type { AppServices } from "../../runtime/AppServices";
import { UploadedAssetSchema } from "../../runtime/contracts/assets";
import type { HttpClient } from "./client";

/**
 * Reference images, on their way up.
 *
 * A plain multipart POST to our own API rather than a presigned PUT straight at
 * the object store. That keeps the store off the public internet entirely — no
 * CORS, no exposed bucket — and it is what lets the server check the file's
 * real type from its bytes and hash it, so uploading the same reference twice
 * costs one transfer instead of two.
 */
export function createHttpAssetsService(client: HttpClient): AppServices["assets"] {
  return {
    upload(file, options) {
      const form = new FormData();
      form.append("file", file);
      return client.request("/assets", {
        method: "POST",
        body: form,
        schema: UploadedAssetSchema,
        signal: options?.signal,
      });
    },
  };
}
