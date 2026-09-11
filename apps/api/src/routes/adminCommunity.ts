import { ModeratePostRequestSchema, PendingPostsSchema, TakeDownPostRequestSchema, type PendingPosts } from "@vgen/contracts";
import type { FastifyInstance } from "fastify";
import type { AdminGuard } from "./admin";

export interface AdminCommunityDependencies {
  moderation: {
    listPending(limit?: number): Promise<PendingPosts>;
    decide(postId: string, decision: "approve" | "reject", reason?: string): Promise<{ status: string } | null>;
    takeDown(postId: string, reason: string): Promise<{ status: string } | null>;
    reportedPosts(
      limit?: number,
    ): Promise<
      { postId: string; caption: string; prompt: string; author: string; reports: number; categories: string[]; firstReportedAt: number }[]
    >;
    resolveReports(postId: string, resolvedBy: string): Promise<number>;
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

  /**
   * What people have complained about, busiest first.
   *
   * A read over the reports rather than a second status on the post: flipping
   * an approved post back to 'pending' would un-publish it on somebody's say-so,
   * which is a heckler's veto by another name. Nothing here is hidden until a
   * person decides it should be.
   */
  app.get("/api/v1/admin/community/reports", async (request, reply) => {
    const session = await guard.require(request, reply, "community.read");
    if (!session) return;
    return reply.send({ reported: await moderation.reportedPosts() });
  });

  /**
   * Mark the open reports on a post as looked at.
   *
   * Whatever was decided. A report read and dismissed is resolved as much as
   * one acted on — the outcome lives in this audit entry and in whether the
   * post is still visible. Without this the queue only ever grows, and a queue
   * that only grows stops being read.
   */
  app.post("/api/v1/admin/community/reports/:id/resolve", async (request, reply) => {
    const session = await guard.require(request, reply, "community.write");
    if (!session) return;
    const { id } = request.params as { id: string };
    const resolved = await moderation.resolveReports(id, session.userId);
    if (resolved === 0) {
      return reply.code(404).send({ error: { code: "no_open_reports", message: "There is nothing open on that post." } });
    }
    await guard.audit(request, session, {
      action: "community.reports.resolved",
      targetType: "post",
      targetId: id,
      after: { resolved },
    });
    return reply.send({ id, resolved });
  });

  /**
   * Pull a published post down.
   *
   * The queue above only moves posts out of `pending`, which is correct for a
   * queue and left the gap this closes: an approved post could not be
   * un-published through any route, so complying with a takedown order meant a
   * hand-written UPDATE against production. That is not a thing to be doing for
   * the first time while a deadline runs.
   *
   * A reason is required rather than optional. A removal with no recorded
   * ground is indistinguishable from an accident six months later, and this is
   * the one action here whose justification somebody may have to produce.
   */
  app.delete("/api/v1/admin/community/posts/:id", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "community.write");
    if (!session) return;

    const { id } = request.params as { id: string };
    const body = TakeDownPostRequestSchema.parse(request.body ?? {});
    const removed = await moderation.takeDown(id, body.reason);

    // Already gone reads the same as never existed, and both mean the screen
    // that issued this is out of date.
    if (!removed) {
      return reply.code(404).send({ error: { code: "not_found", message: "That post is not published." } });
    }

    await guard.audit(request, session, {
      action: "community.post.takedown",
      targetType: "post",
      targetId: id,
      before: { status: removed.status, visible: true },
      after: { visible: false, reason: body.reason },
    });

    return reply.send({ id, visible: false });
  });
}
