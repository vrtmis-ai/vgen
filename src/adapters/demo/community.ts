import { z } from "zod";
import type { AppServices } from "../../runtime/AppServices";
import { CommunityPostSchema } from "../../runtime/contracts/community";
import snapshot from "../../data/community.snapshot.json";

/**
 * The feed demo mode serves, generated from Postgres like the catalog and the
 * content beside it — not read from `community.rows.json`, which is the
 * seeder's input rather than its output.
 *
 * Regenerate with `pnpm community:publish && pnpm community:snapshot`.
 */
const posts = z.array(CommunityPostSchema).parse(snapshot.posts);

export function createDemoCommunityService(): AppServices["community"] {
  return {
    async list() {
      return { posts };
    },
  };
}
