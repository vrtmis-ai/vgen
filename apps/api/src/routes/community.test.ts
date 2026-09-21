import type { ShareOutcome } from "@vgen/db";
import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAdminCommunityRoutes } from "./adminCommunity";
import { registerCommunityRoutes } from "./community";
import type { AdminGuard } from "./admin";

const SIGNED_IN = { status: "authed" as const, user: { id: "11111111-1111-4111-8111-111111111111" } };
const JOB_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "33333333-3333-4333-8333-333333333333";

function appFor(outcome: ShareOutcome, identity: unknown = SIGNED_IN) {
  const report = vi.fn(async () => "recorded" as const);
  const share = vi.fn(async () => outcome);
  const app = Fastify({ logger: false });
  // The same handler createApp installs, so a rejected body is the 400 the
  // route actually answers rather than the 500 a bare Fastify would.
  registerErrorHandling(app);
  registerCommunityRoutes(
    app,
    { getCurrent: vi.fn(async () => identity) } as never,
    { list: vi.fn(async () => ({ posts: [] })) },
    { share, report },
  );
  return { app, share, report };
}

const shared = (): ShareOutcome => ({ outcome: "shared", post: { id: POST_ID, status: "pending" } });
const body = { jobId: JOB_ID, consent: true };

describe("sharing into the feed", () => {
  it("takes the share and says it is not published yet", async () => {
    const { app, share } = appFor(shared());

    const response = await app.inject({ method: "POST", url: "/api/v1/community", payload: body });

    // 202 and not 201, and the difference is the whole shape of this route: the
    // post exists and the feed does not have it. 201 would send the author to
    // look for something that is not there, which reads as a bug not a queue.
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ id: POST_ID, status: "pending" });
    expect(share).toHaveBeenCalledWith({ userId: SIGNED_IN.user.id, jobId: JOB_ID, caption: undefined, promptVisible: true });
  });

  it("refuses a stranger before it touches the database", async () => {
    const { app, share } = appFor(shared(), { status: "anonymous" });

    const response = await app.inject({ method: "POST", url: "/api/v1/community", payload: body });

    expect(response.statusCode).toBe(401);
    expect(share).not.toHaveBeenCalled();
  });

  /**
   * §14 requires the author's agreement to expose the prompt, the settings and
   * any reference files, taken at share time. A default would make silence mean
   * yes, which is the one reading of silence that is not available here.
   */
  it("will not share without consent, whatever else the body says", async () => {
    const { app, share } = appFor(shared());

    for (const payload of [{ jobId: JOB_ID }, { jobId: JOB_ID, consent: false }, { jobId: JOB_ID, consent: "yes" }]) {
      const response = await app.inject({ method: "POST", url: "/api/v1/community", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(share).not.toHaveBeenCalled();
  });

  it("passes the caption and the recipe choice through as sent", async () => {
    const { app, share } = appFor(shared());

    await app.inject({
      method: "POST",
      url: "/api/v1/community",
      payload: { jobId: JOB_ID, consent: true, caption: "sunset no. 4", promptVisible: false },
    });

    expect(share).toHaveBeenCalledWith({
      userId: SIGNED_IN.user.id,
      jobId: JOB_ID,
      caption: "sunset no. 4",
      promptVisible: false,
    });
  });

  it("gives each refusal its own status, so a client can tell them apart", async () => {
    const cases: [ShareOutcome["outcome"], number][] = [
      ["banned", 403],
      ["unknown_job", 404],
      ["already_shared", 409],
      ["not_finished", 409],
      ["nothing_to_show", 409],
    ];

    for (const [outcome, status] of cases) {
      const { app } = appFor({ outcome } as ShareOutcome);
      const response = await app.inject({ method: "POST", url: "/api/v1/community", payload: body });
      expect(response.statusCode).toBe(status);
      expect(response.json().error.code).toBe(outcome);
    }
  });

  it("leaves reading the feed public", async () => {
    const { app } = appFor(shared(), { status: "anonymous" });

    expect((await app.inject({ method: "GET", url: "/api/v1/community" })).statusCode).toBe(200);
  });
});

function adminAppFor(
  decided: { status: string } | null,
  permission: { granted: boolean } = { granted: true },
  removed: { status: string } | null = { status: "approved" },
): {
  app: FastifyInstance;
  audit: ReturnType<typeof vi.fn>;
  decide: ReturnType<typeof vi.fn>;
  takeDown: ReturnType<typeof vi.fn>;
  reportedPosts: ReturnType<typeof vi.fn>;
  resolveReports: ReturnType<typeof vi.fn>;
} {
  const audit = vi.fn(async () => {});
  const decide = vi.fn(async () => decided);
  const guard: AdminGuard = {
    require: vi.fn(async (_request, reply, _permission) => {
      if (permission.granted) return { userId: "admin-1", roles: ["admin"], permissions: ["*"], mfaVerified: true } as never;
      void reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
      return null;
    }),
    audit,
  };
  const app = Fastify({ logger: false });
  registerErrorHandling(app);
  const takeDown = vi.fn(async () => removed);
  const reportedPosts = vi.fn(async () => []);
  const resolveReports = vi.fn(async () => 2);
  registerAdminCommunityRoutes(
    app,
    { moderation: { listPending: vi.fn(async () => ({ posts: [] })), decide, takeDown, reportedPosts, resolveReports } },
    guard,
  );
  return { app, audit, decide, takeDown, reportedPosts, resolveReports };
}

describe("deciding on what was shared", () => {
  it("records an approval in the audit log", async () => {
    const { app, audit } = adminAppFor({ status: "approved" });

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/pending/${POST_ID}`,
      payload: { decision: "approve" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ id: POST_ID, status: "approved" });
    // Approving is a decision to show one person's work, and their prompt, to
    // everyone who opens the site. That is what audit_log is for.
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "community.post.approve", targetType: "post", targetId: POST_ID }),
    );
  });

  it("keeps the reason with a rejection", async () => {
    const { app, audit, decide } = adminAppFor({ status: "rejected" });

    await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/pending/${POST_ID}`,
      payload: { decision: "reject", reason: "not what this feed is for" },
    });

    expect(decide).toHaveBeenCalledWith(POST_ID, "reject", "not what this feed is for");
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "community.post.reject", after: { status: "rejected", reason: "not what this feed is for" } }),
    );
  });

  /**
   * Two moderators on one row. The second one's screen is out of date, and
   * telling them their decision landed would be a lie the audit log then
   * disagrees with.
   */
  it("answers 404 when somebody already decided, and writes no audit entry", async () => {
    const { app, audit } = adminAppFor(null);

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/pending/${POST_ID}`,
      payload: { decision: "approve" },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("not_pending");
    expect(audit).not.toHaveBeenCalled();
  });

  it("is not there at all for someone without the permission", async () => {
    const { app, decide } = adminAppFor({ status: "approved" }, { granted: false });

    const listed = await app.inject({ method: "GET", url: "/api/v1/admin/community/pending" });
    const decided = await app.inject({
      method: "POST",
      url: `/api/v1/admin/community/pending/${POST_ID}`,
      payload: { decision: "approve" },
    });

    expect(listed.statusCode).toBe(404);
    expect(decided.statusCode).toBe(404);
    expect(decide).not.toHaveBeenCalled();
  });
});

/* The gap the compliance audit found. `decide()` matches `status = 'pending'`,
   which is right for a queue and means an approved post could not be
   un-published through any route at all — complying with a takedown order
   required a hand-written UPDATE against production. */
describe("taking a published post down", () => {
  const remove = (app: FastifyInstance, payload: unknown) =>
    app.inject({ method: "DELETE", url: "/api/v1/admin/community/posts/post-1", payload: payload as never });

  it("removes it and writes down why", async () => {
    const { app, audit, takeDown } = adminAppFor({ status: "approved" });

    const response = await remove(app, { reason: "court order 1404/123" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: "post-1", visible: false });
    expect(takeDown).toHaveBeenCalledWith("post-1", "court order 1404/123");
    // Audited like the approval it reverses. This is the action somebody may
    // have to produce a record of, months later, to somebody outside.
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ action: "community.post.takedown", targetId: "post-1" }),
    );
  });

  it("refuses a removal with no recorded ground", async () => {
    const { app, takeDown } = adminAppFor({ status: "approved" });

    // Six months later a removal with no reason is indistinguishable from an
    // accident, which is why this is required where a rejection's is optional.
    expect((await remove(app, {})).statusCode).toBe(400);
    expect((await remove(app, { reason: "x" })).statusCode).toBe(400);
    expect(takeDown).not.toHaveBeenCalled();
  });

  it("answers 404 for a post that is already gone", async () => {
    const { app, audit } = adminAppFor(null, { granted: true }, null);

    const response = await remove(app, { reason: "already handled" });

    expect(response.statusCode).toBe(404);
    // No second audit entry claiming a second takedown. A repeated call is a
    // stale screen, not a new event.
    expect(audit).not.toHaveBeenCalled();
  });

  it("does not let an admin without the permission remove anything", async () => {
    const { app, takeDown } = adminAppFor({ status: "approved" }, { granted: false });

    const response = await remove(app, { reason: "court order 1404/123" });

    expect(response.statusCode).toBe(404);
    expect(takeDown).not.toHaveBeenCalled();
  });
});

/* A report puts a post in front of a person. It hides nothing on its own — a
   report that un-publishes is a heckler's veto with one click, and the first
   use anybody finds for one is aiming it at a competitor. */
describe("reporting a post", () => {
  const report = (app: FastifyInstance, payload: unknown) =>
    app.inject({ method: "POST", url: "/api/v1/community/posts/post-1/report", payload: payload as never });

  it("records a report from a signed-in visitor", async () => {
    const { app, report: spy } = appFor({ outcome: "shared", post: { id: POST_ID } } as never);

    const response = await report(app, { category: "illegal", note: "این نباید اینجا باشد" });

    expect(response.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ postId: "post-1", category: "illegal", note: "این نباید اینجا باشد" }));
  });

  it("defaults the category rather than refusing a bare press", async () => {
    const { app, report: spy } = appFor({ outcome: "shared", post: { id: POST_ID } } as never);

    expect((await report(app, {})).statusCode).toBe(200);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ category: "other" }));
  });

  it("does not take reports from strangers", async () => {
    const { app, report: spy } = appFor({ outcome: "shared", post: { id: POST_ID } } as never, { status: "anonymous" });

    expect((await report(app, {})).statusCode).toBe(401);
    // Attributable, so one person cannot file a thousand.
    expect(spy).not.toHaveBeenCalled();
  });
});
