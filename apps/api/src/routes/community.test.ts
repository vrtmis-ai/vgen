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
  const share = vi.fn(async () => outcome);
  const app = Fastify({ logger: false });
  // The same handler createApp installs, so a rejected body is the 400 the
  // route actually answers rather than the 500 a bare Fastify would.
  registerErrorHandling(app);
  registerCommunityRoutes(
    app,
    { getCurrent: vi.fn(async () => identity) } as never,
    { list: vi.fn(async () => ({ posts: [] })) },
    { share },
  );
  return { app, share };
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
): { app: FastifyInstance; audit: ReturnType<typeof vi.fn>; decide: ReturnType<typeof vi.fn> } {
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
  registerAdminCommunityRoutes(app, { moderation: { listPending: vi.fn(async () => ({ posts: [] })), decide } }, guard);
  return { app, audit, decide };
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
