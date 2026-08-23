import { ModeratePostRequestSchema, PendingPostsSchema, type PendingPosts } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminGuard } from "./admin";

export interface AdminCommunityDependencies {
  moderation: {
    listPending(limit?: number): Promise<PendingPosts>;
    decide(postId: string, decision: "approve" | "reject", reason?: string): Promise<{ status: string } | null>;
  };
}

/**
 * The moderation queue, which is the other half of `POST /api/v1/community`.
 *
 * A share lands `pending` and nothing moves it on its own. Without these two
 * routes the customer endpoint writes into a queue with no consumer, and the
 * author is told to wait for a review that cannot happen.
 *
 * Both are audited. Approving a post is a decision to show one person's work,
 * and their prompt, to everyone who opens the site — which is exactly the class
 * of action `audit_log` exists for.
 */
export function registerAdminCommunityRoutes(app: FastifyInstance, dependencies: AdminCommunityDependencies, guard: AdminGuard): void {
  const { moderation } = dependencies;

  app.get("/api/v1/admin/community/pending", async (request, reply) => {
    const session = await guard.require(request, reply, "community.read");
    if (!session) return;
    return reply.send(PendingPostsSchema.parse(await moderation.listPending()));
  });

  app.post("/api/v1/admin/community/pending/:id", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "community.write");
    if (!session) return;

    const { id } = request.params as { id: string };
    const body = ModeratePostRequestSchema.parse(request.body);
    const decided = await moderation.decide(id, body.decision, body.reason);

    // Null covers both "no such post" and "somebody already decided it", and
    // they are the same answer on purpose: the second moderator's screen is out
    // of date either way, and the fix for both is to re-read the queue.
    if (!decided) {
      return reply.code(404).send({ error: { code: "not_pending", message: "That post is not waiting for a decision." } });
    }

    await guard.audit(request, session, {
      action: body.decision === "approve" ? "community.post.approve" : "community.post.reject",
      targetType: "post",
      targetId: id,
      after: { status: decided.status, ...(body.reason ? { reason: body.reason } : {}) },
    });

    return reply.send({ id, status: decided.status });
  });
}
