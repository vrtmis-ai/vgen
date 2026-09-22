import type { FastifyInstance } from "fastify";
import type { ContentSnapshot } from "@vgen/contracts";
import { publicJson } from "../publicJson";

export interface CustomerContentApplication {
  list(): Promise<ContentSnapshot>;
}

/** Signs a link to one uploaded cover or lesson, or null for a name it never issued. See `ContentMediaService`. */
export interface ContentMediaReader {
  signedUrl(file: string): Promise<string | null>;
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
export function registerContentRoute(app: FastifyInstance, content: CustomerContentApplication, media?: ContentMediaReader): void {
  const send = publicJson<ContentSnapshot>();
  app.get("/api/v1/content", async (_request, reply) => send(reply, await content.list()));

  /**
   * An admin's upload, by the name stored in the row.
   *
   * A redirect to a freshly signed URL, so the bucket stays private and the
   * link in the row never expires. Cached for half the signature's life: a
   * cache that kept the redirect longer would hand out a dead URL.
   */
  if (media) {
    app.get("/api/v1/content/media/:file", async (request, reply) => {
      const url = await media.signedUrl((request.params as { file: string }).file);
      if (!url) return reply.code(404).send({ error: { code: "not_found", message: "No such file." } });
      return reply.header("Cache-Control", "public, max-age=1800").redirect(url, 302);
    });
  }
}
