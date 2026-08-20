import type { FastifyInstance } from "fastify";
import type { CommunityFeed } from "@vgen/contracts";

export interface CustomerCommunityApplication {
  list(): Promise<CommunityFeed>;
}

/**
 * Public, like the catalog and the content beside it.
 *
 * A feed of what people made with the product is the strongest thing it can
 * show someone deciding whether to sign up, and it is already the only content
 * here that a stranger chose to make public.
 */
export function registerCommunityRoute(app: FastifyInstance, community: CustomerCommunityApplication): void {
  app.get("/api/v1/community", async () => community.list());
}
