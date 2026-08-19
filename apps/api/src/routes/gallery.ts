import { GalleryQuerySchema } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";
import type { GenerationLibraryApplication } from "../generationLibrary";
import type { CustomerSessionApplication } from "./session";

/**
 * Everything this account has made.
 *
 * Keyset pagination, not offset: `nextCursor` is the last id you were given,
 * and because `jobs.id` is a uuid v7 it already sorts by creation time. A
 * generation finishing while somebody is paging therefore cannot shift the
 * page under them, which an offset would.
 *
 * The cursor is opaque on purpose. It happens to be a job id today; treating it
 * as one in a client is how a pagination scheme becomes impossible to change.
 */
export function registerGalleryRoute(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  library: GenerationLibraryApplication,
): void {
  app.get("/api/v1/gallery", async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const query = GalleryQuerySchema.parse(request.query ?? {});
    return reply.code(200).send(await library.list(session.user.id, query));
  });
}
