import type { AppServices } from "../../runtime/AppServices";
import { CommunityFeedSchema } from "../../runtime/contracts/community";
import type { HttpClient } from "./client";

export function createHttpCommunityService(client: HttpClient): AppServices["community"] {
  return {
    list(options) {
      return client.request("/community", { schema: CommunityFeedSchema, signal: options?.signal });
    },
  };
}
