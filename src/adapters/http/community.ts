import type { AppServices } from "../../runtime/AppServices";
import { z } from "zod";
import { CommunityFeedSchema } from "../../runtime/contracts/community";

const ReportedSchema = z.object({ id: z.string(), reported: z.boolean() });
import type { HttpClient } from "./client";

export function createHttpCommunityService(client: HttpClient): AppServices["community"] {
  return {
    list(options) {
      return client.request("/community", { schema: CommunityFeedSchema, signal: options?.signal });
    },
    async report(postId, input, options) {
      await client.request(`/community/posts/${encodeURIComponent(postId)}/report`, {
        method: "POST",
        body: input,
        schema: ReportedSchema,
        signal: options?.signal,
      });
    },
  };
}
