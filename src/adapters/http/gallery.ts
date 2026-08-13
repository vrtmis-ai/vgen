import type { AppServices } from "../../app/AppServices";
import { GalleryPageSchema } from "../../app/contracts/gallery";
import type { HttpClient } from "./client";

export function createHttpGalleryService(client: HttpClient): AppServices["gallery"] {
  return {
    list(query = {}, options) {
      const search = new URLSearchParams();
      if (query.cursor) search.set("cursor", query.cursor);
      if (query.limit !== undefined) search.set("limit", String(query.limit));
      if (query.kind) search.set("kind", query.kind);
      const suffix = search.size ? `?${search.toString()}` : "";
      return client.request(`/gallery${suffix}`, { schema: GalleryPageSchema, signal: options?.signal });
    },
  };
}
