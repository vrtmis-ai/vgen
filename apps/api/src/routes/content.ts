import type { FastifyInstance } from "fastify";
import type { ContentSnapshot } from "@vgen/contracts";

export interface CustomerContentApplication {
  list(): Promise<ContentSnapshot>;
}

/**
 * Public, like the catalog and the plans it sits beside.
 *
 * Everything here is what the product shows a visitor before they have an
 * account: the effects grid, the featured shelf, the course list. Gating it
 * would mean a landing page that cannot show what the product does.
 *
 * One route for seven collections rather than seven routes, because every
 * screen that needs one of them is reached through a shell that already
 * fetches the catalog once — a second fetch on the same boot is cheaper than
 * seven, and the payload is smaller than the catalog it travels with.
 */
export function registerContentRoute(app: FastifyInstance, content: CustomerContentApplication): void {
  app.get("/api/v1/content", async () => content.list());
}
