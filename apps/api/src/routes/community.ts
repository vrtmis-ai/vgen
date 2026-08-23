import { SharePostRequestSchema, SharedPostSchema, type CommunityFeed } from "@vgen/contracts";
import type { ShareOutcome, SharePostInput } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import type { CustomerSessionApplication } from "./session";

export interface CustomerCommunityApplication {
  list(): Promise<CommunityFeed>;
}

export interface CommunitySubmissionsApplication {
  share(input: SharePostInput): Promise<ShareOutcome>;
}

/**
 * Reading the feed is public, like the catalog and the content beside it.
 *
 * A feed of what people made with the product is the strongest thing it can
 * show someone deciding whether to sign up, and it is already the only content
 * here that a stranger chose to make public.
 *
 * Writing to it is not. Sharing needs an account, because the post carries that
 * account's name on it forever.
 */
export function registerCommunityRoutes(
  app: FastifyInstance,
  sessions: CustomerSessionApplication,
  community: CustomerCommunityApplication,
  submissions: CommunitySubmissionsApplication,
): void {
  app.get("/api/v1/community", async () => community.list());

  /**
   * Share a finished generation into the feed.
   *
   * Answers 202 rather than 201, and the distinction is the whole shape of this
   * route: the post exists, and it is not published. Nothing here publishes.
   * 201 would say "created, go and look at it", and the author would go and
   * look at a feed that does not have it — which reads as a bug rather than as
   * a queue.
   */
  app.post("/api/v1/community", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const session = await sessions.getCurrent(request);
    if (session.status !== "authed") {
      return reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required." } });
    }

    const body = SharePostRequestSchema.parse(request.body);
    const result = await submissions.share({
      userId: session.user.id,
      jobId: body.jobId,
      caption: body.caption,
      promptVisible: body.promptVisible,
    });

    if (result.outcome === "shared") return reply.code(202).send(SharedPostSchema.parse(result.post));

    // A ban under `explore` or `platform` bars publishing and nothing else:
    // someone who paid for generations keeps the ones they already have, and
    // keeps making more. This is the only thing it refuses.
    if (result.outcome === "banned") {
      return reply.code(403).send({ error: { code: result.outcome, message: "Your account cannot publish to the feed." } });
    }

    // Somebody else's job is "not found" and not "not yours". Confirming that
    // an id exists but belongs to another account turns this into a way of
    // discovering ids by guessing them.
    if (result.outcome === "unknown_job") {
      return reply.code(404).send({ error: { code: result.outcome, message: "That generation is not in your library." } });
    }

    if (result.outcome === "already_shared") {
      // 409 rather than a quiet 202: the second tap of a double-tapped button
      // and a genuine re-share are the same request, and the honest answer to
      // both is that the post already exists.
      return reply.code(409).send({ error: { code: result.outcome, message: "You have already shared this one." } });
    }

    if (result.outcome === "not_finished") {
      return reply.code(409).send({ error: { code: result.outcome, message: "Wait for it to finish first." } });
    }

    // Audio, or a generation whose outputs have been deleted. The job is real
    // and finished; there is simply no card the feed could draw for it.
    return reply.code(409).send({ error: { code: result.outcome, message: "There is nothing here the feed can show." } });
  });
}
