import type { AppServices } from "../../runtime/AppServices";
import { ContentSnapshotSchema } from "../../runtime/contracts/content";
import type { HttpClient } from "./client";

export function createHttpContentService(client: HttpClient): AppServices["content"] {
  return {
    list(options) {
      return client.request("/content", { schema: ContentSnapshotSchema, signal: options?.signal });
    },
  };
}
