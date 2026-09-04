import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAdminRoutes } from "./admin";

const ADMIN = {
  sessionId: "s1",
  userId: "u-admin",
  email: "admin@deev.test",
  roles: ["admin"],
  permissions: ["*"],
  hasMfa: true,
  mfaVerified: true,
};

const invite = { id: "i1", code: "apple-deev", grantCoins: 20, usersJoined: 2, coinsSpent: 7 };

function build(session: Partial<typeof ADMIN> | null = ADMIN) {
  const admin = {
    resolveSession: vi.fn(async (_token: string) => (session ? { ...ADMIN, ...session } : null)),
    resolvePrincipal: vi.fn(async (_userId: string) => ({ ...ADMIN })),
    createSession: vi.fn(async () => ({ token: "adm-tok", expiresAt: new Date(Date.now() + 3_600_000) })),
    markSessionMfaVerified: vi.fn(async () => undefined),
    verifySecondFactor: vi.fn(async (_userId: string, code: string) => code === "111111"),
    revokeSession: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => [
      {
        id: "s1",
        userId: "u-admin",
        email: "admin@deev.test",
        ip: "127.0.0.1",
        userAgent: "Mozilla/5.0 (test)",
        mfaVerified: true,
        createdAt: 1,
        lastUsedAt: 2,
        expiresAt: 3,
      },
      {
        id: "s2",
        userId: "u-other",
        email: "other@deev.test",
        ip: "5.5.5.5",
        userAgent: "Mozilla/5.0 (elsewhere)",
        mfaVerified: false,
        createdAt: 1,
        lastUsedAt: null,
        expiresAt: 3,
      },
    ]),
    revokeSessionById: vi.fn(async () => true),
    revokeOtherSessions: vi.fn(async () => 3),
    recordAudit: vi.fn(async () => undefined),
  };
  const access = {
    listInvites: vi.fn(async () => [invite]),
    getInvite: vi.fn(async () => invite),
    listInviteRedeemers: vi.fn(async () => [{ userId: "u2", coinsSpent: 7, redeemedAt: 1 }]),
    createInvite: vi.fn(async () => invite),
    createInviteBatch: vi.fn(async (count: number) => Array.from({ length: count }, (_, i) => ({ ...invite, id: `i${i}` }))),
    // Widened, because one test swaps this for the "deleted" outcome.
    deleteInvite: vi.fn(async (): Promise<"deleted" | "has_redemptions" | "not_found"> => "has_redemptions"),
    revokeInvite: vi.fn(async () => ({ ...invite, isUsable: false })),
    listPromos: vi.fn(async () => []),
    getPromo: vi.fn(async () => ({ id: "p1", code: "nowruz" })),
    createPromo: vi.fn(async () => ({ id: "p1", code: "nowruz" })),
    deletePromo: vi.fn(async () => "deleted" as const),
    revokePromo: vi.fn(async () => ({ id: "p1" })),
    isEarlyAccess: vi.fn(async () => true),
    setEarlyAccess: vi.fn(async (enabled: boolean) => enabled),
    isSiteBanner: vi.fn(async () => true),
    setSiteBanner: vi.fn(async (enabled: boolean) => enabled),
  };
  const verifyPassword = vi.fn(async () => ({ id: "u-admin", emailNormalized: "admin@deev.test" }));

  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAdminRoutes(app, { admin: admin as never, access: access as never, verifyPassword }, { cookie: { secure: true } });
  return { app, admin, access, verifyPassword };
}

const AS_ADMIN = { cookie: "deev_admin=adm-tok" };

describe("GET /admin/session — what the panel asks before it renders", () => {
  it("answers 404 with no cookie, like the rest of the surface", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/session" });

    // Not 401. An expired staff cookie and a customer typing the URL must be
    // indistinguishable from outside.
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("reports a half-authenticated session as mfa_required, and grants it nothing", async () => {
    const { app } = build({ mfaVerified: false });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/session", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "mfa_required", roles: ["admin"] });
    // The empty array is the point: a panel can render straight off
    // `permissions` without also remembering to check `status`, so a session
    // that has not proved a second factor cannot draw a section it would be
    // refused from.
    expect(response.json().permissions).toEqual([]);
    await app.close();
  });

  it("reports a verified session with the permissions it actually holds", async () => {
    const { app } = build({ permissions: ["catalog.read", "invites.*"] });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/session", headers: AS_ADMIN });

    expect(response.json()).toMatchObject({
      status: "authed",
      email: "admin@deev.test",
      permissions: ["catalog.read", "invites.*"],
    });
    await app.close();
  });

  it("is reachable before the second factor, which is the whole reason it is not behind require()", async () => {
    // Every other route answers 403 mfa_required here. This one has to answer,
    // or a reload during sign-in could not resume where the session actually is.
    const { app } = build({ mfaVerified: false });

    const blocked = await app.inject({ method: "GET", url: "/api/v1/admin/invites", headers: AS_ADMIN });
    const readable = await app.inject({ method: "GET", url: "/api/v1/admin/session", headers: AS_ADMIN });

    expect(blocked.statusCode).toBe(403);
    expect(readable.statusCode).toBe(200);
    await app.close();
  });
});

describe("reaching the admin surface at all", () => {
  it("answers 404 with no admin cookie, not 401", async () => {
    // A customer poking at /admin must not learn that the surface exists.
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/invites" });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("answers 404 for a signed-in customer holding no staff role", async () => {
    const { app } = build(null);

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/invites", headers: AS_ADMIN });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a staff session that has not passed its second factor", async () => {
    const { app, access } = build({ mfaVerified: false });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/invites", headers: AS_ADMIN });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("mfa_required");
    expect(access.listInvites).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a role that lacks the permission the route names", async () => {
    // support can read invites but must not be able to mint them.
    const { app, access } = build({ roles: ["support"], permissions: ["invites.read"] });

    const read = await app.inject({ method: "GET", url: "/api/v1/admin/invites", headers: AS_ADMIN });
    const write = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invites",
      headers: AS_ADMIN,
      payload: { code: "sneaky" },
    });

    expect(read.statusCode).toBe(200);
    expect(write.statusCode).toBe(403);
    expect(write.json().error.code).toBe("forbidden");
    expect(access.createInvite).not.toHaveBeenCalled();
    await app.close();
  });

  it("honours a section wildcard", async () => {
    const { app } = build({ roles: ["growth"], permissions: ["invites.*"] });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invites",
      headers: AS_ADMIN,
      payload: { code: "wildcard-ok" },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
  });
});

describe("signing in as staff", () => {
  it("issues a session that authorises nothing until MFA", async () => {
    const { app, admin } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session",
      payload: { email: "admin@deev.test", password: "a long enough password" },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "mfa_required" });
    expect(admin.markSessionMfaVerified).not.toHaveBeenCalled();
    const cookie = String(response.headers["set-cookie"]);
    // Its own cookie, so a stolen customer session is never an admin one.
    expect(cookie).toContain("deev_admin=adm-tok");
    expect(cookie).not.toContain("deev_session=");
    await app.close();
  });

  it("refuses an account with no second factor enrolled", async () => {
    const { app, admin } = build();
    admin.resolvePrincipal = vi.fn(async () => ({ ...ADMIN, hasMfa: false }));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session",
      payload: { email: "admin@deev.test", password: "a long enough password" },
    });

    // Letting them in "just this once" is how v_admins_without_mfa stops being empty.
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("mfa_not_enrolled");
    expect(admin.createSession).not.toHaveBeenCalled();
    await app.close();
  });

  it("gives a wrong password the same answer as a non-staff account", async () => {
    const { app, verifyPassword } = build();
    verifyPassword.mockRejectedValueOnce(new Error("invalid_credentials"));

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session",
      payload: { email: "nobody@deev.test", password: "wrong password" },
    });

    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("records a failed second factor and does not mark the session", async () => {
    const { app, admin } = build({ mfaVerified: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session/mfa",
      headers: AS_ADMIN,
      payload: { code: "000000" },
    });

    expect(response.statusCode).toBe(403);
    expect(admin.markSessionMfaVerified).not.toHaveBeenCalled();
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.mfa.failed" }));
    await app.close();
  });

  it("marks the session once the code is right", async () => {
    const { app, admin } = build({ mfaVerified: false });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session/mfa",
      headers: AS_ADMIN,
      payload: { code: "111111" },
    });

    expect(response.statusCode).toBe(200);
    expect(admin.markSessionMfaVerified).toHaveBeenCalledWith("adm-tok");
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin.signed_in" }));
    await app.close();
  });
});

describe("managing invite codes", () => {
  it("creates a campaign code and audits it", async () => {
    const { app, admin, access } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invites",
      headers: AS_ADMIN,
      payload: { code: "apple-deev", label: "Apple campaign", maxRedemptions: 500, grantCoins: 20, grantExpiresDays: 30 },
    });

    expect(response.statusCode).toBe(201);
    expect(access.createInvite).toHaveBeenCalledWith(expect.objectContaining({ code: "apple-deev", createdBy: "u-admin" }));
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invite.created", actorUserId: "u-admin" }));
    await app.close();
  });

  it("generates a batch when asked for several", async () => {
    const { app, access } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invites",
      headers: AS_ADMIN,
      payload: { count: 25, maxRedemptions: 1 },
    });

    expect(response.statusCode).toBe(201);
    expect(access.createInviteBatch).toHaveBeenCalledWith(25, expect.objectContaining({ createdBy: "u-admin" }));
    expect(response.json().invites).toHaveLength(25);
    await app.close();
  });

  it("refuses a batch that shares one custom code", async () => {
    const { app, access } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/invites",
      headers: AS_ADMIN,
      payload: { count: 10, code: "apple-deev" },
    });

    expect(response.statusCode).toBe(400);
    expect(access.createInviteBatch).not.toHaveBeenCalled();
    await app.close();
  });

  it("revokes rather than deletes a code somebody used", async () => {
    const { app, admin, access } = build();

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/invites/i1", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(response.json().outcome).toBe("revoked");
    expect(access.revokeInvite).toHaveBeenCalledWith("i1", "u-admin");
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invite.revoked" }));
    await app.close();
  });

  it("deletes a code nobody used", async () => {
    const { app, access, admin } = build();
    access.deleteInvite = vi.fn(async () => "deleted" as const);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/invites/i1", headers: AS_ADMIN });

    expect(response.json().outcome).toBe("deleted");
    expect(access.revokeInvite).not.toHaveBeenCalled();
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "invite.deleted" }));
    await app.close();
  });

  it("reports who joined and what they spent", async () => {
    const { app } = build();

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/invites/i1", headers: AS_ADMIN });

    expect(response.json()).toMatchObject({
      invite: { code: "apple-deev", usersJoined: 2, coinsSpent: 7 },
      redeemers: [{ userId: "u2", coinsSpent: 7 }],
    });
    await app.close();
  });
});

describe("managing discount codes", () => {
  it("creates a flat-Toman first-purchase code", async () => {
    const { app, access, admin } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promos",
      headers: AS_ADMIN,
      payload: { code: "nowruz", kind: "amount_off", amountOff: 200000, firstPurchaseOnly: true },
    });

    expect(response.statusCode).toBe(201);
    expect(access.createPromo).toHaveBeenCalledWith(expect.objectContaining({ kind: "amount_off", amountOff: 200000 }));
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "promo.created" }));
    await app.close();
  });

  it("rejects a kind the schema does not offer", async () => {
    const { app, access } = build();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/promos",
      headers: AS_ADMIN,
      payload: { kind: "buy_one_get_one" },
    });

    expect(response.statusCode).toBe(400);
    expect(access.createPromo).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("the early access gate", () => {
  it("opens the product and audits both sides of the change", async () => {
    const { app, access, admin } = build();

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/early-access",
      headers: AS_ADMIN,
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false });
    expect(access.setEarlyAccess).toHaveBeenCalledWith(false, "u-admin");
    expect(admin.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "early_access.changed", before: { enabled: true }, after: { enabled: false } }),
    );
    await app.close();
  });

  it("needs flags.write, which reading the gate does not", async () => {
    const { app } = build({ roles: ["support"], permissions: ["invites.read"] });

    const read = await app.inject({ method: "GET", url: "/api/v1/admin/early-access", headers: AS_ADMIN });
    const write = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/early-access",
      headers: AS_ADMIN,
      payload: { enabled: false },
    });

    expect(read.statusCode).toBe(200);
    expect(write.statusCode).toBe(403);
    await app.close();
  });
});

/**
 * Listing and ending staff sessions.
 *
 * The point of the surface is the question *is there a session open that I do
 * not recognise?* — so what matters is that it answers honestly, marks the
 * caller's own row, and never carries a token. `admin_sessions` stores only a
 * hash, and these assert the route has not started selecting one.
 */
describe("open staff sessions", () => {
  it("answers 404 with no staff session at all", async () => {
    const { app } = build(null);
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/sessions", headers: AS_ADMIN })).statusCode).toBe(404);
    await app.close();
  });

  it("needs security.read, which catalogue or invite permissions do not give", async () => {
    const { app, admin } = build({ roles: ["support"], permissions: ["catalog.read", "invites.read"] });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/sessions", headers: AS_ADMIN });

    expect(response.statusCode).toBe(403);
    expect(admin.listSessions).not.toHaveBeenCalled();
    await app.close();
  });

  it("marks the caller's own session and returns no token", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/sessions", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    const rows = response.json().sessions as { id: string; current: boolean }[];
    expect(rows.find((row) => row.id === "s1")?.current).toBe(true);
    expect(rows.find((row) => row.id === "s2")?.current).toBe(false);
    // The whole body, not just one field: a column added later must not smuggle
    // a secret onto a screen four people can open.
    expect(response.body).not.toMatch(/token/i);
    await app.close();
  });

  it("refuses to end a session without security.write", async () => {
    const { app, admin } = build({ roles: ["auditor"], permissions: ["security.read"] });
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/sessions/s2", headers: AS_ADMIN });

    // Reading who is signed in and being able to sign them out are different
    // jobs, and an auditor only needs the first.
    expect(response.statusCode).toBe(403);
    expect(admin.revokeSessionById).not.toHaveBeenCalled();
    await app.close();
  });

  it("ends one session and audits which", async () => {
    const { app, admin } = build();
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/sessions/s2", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(admin.revokeSessionById).toHaveBeenCalledWith("s2");
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "admin_session.revoked", targetId: "s2" }));
    await app.close();
  });

  it("clears the cookie when you end your own session", async () => {
    const { app } = build();
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/sessions/s1", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    // Revoking the row you are sitting on is a legitimate thing to do from
    // here; leaving the cookie would send a dead token on every later request.
    expect(String(response.headers["set-cookie"])).toContain("deev_admin=;");
    await app.close();
  });

  it("answers 404 when there was nothing open to end", async () => {
    const { app, admin } = build();
    admin.revokeSessionById.mockResolvedValueOnce(false);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/sessions/gone", headers: AS_ADMIN });

    // A cheerful 204 would leave the caller believing they had closed something.
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it("ends every other session and keeps the one asking", async () => {
    const { app, admin } = build();
    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/sessions", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(3);
    // Keeping the caller's is the point: this is the button somebody presses
    // when they think they have been compromised, and locking themselves out
    // in the same act would be unhelpful.
    expect(admin.revokeOtherSessions).toHaveBeenCalledWith("s1");
    await app.close();
  });
});

describe("the staff cookie", () => {
  it("is SameSite=Strict, unlike the customer one", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/admin/session",
      payload: { email: "admin@deev.test", password: "hunter2hunter2" },
    });

    // Nothing navigates cross-site into /admin — no OAuth return, no email
    // link, no payment callback — so Strict costs nothing here and removes the
    // whole class of request where another site makes a browser send a staff
    // session somewhere. The customer cookie stays Lax because the Google
    // callback genuinely is such a navigation.
    expect(String(response.headers["set-cookie"])).toContain("SameSite=Strict");
    await app.close();
  });
});

/**
 * The announcement strip's switch.
 *
 * #61 asked for this and named the shape: one `feature_flags` row, no new
 * table, no new customer route, toggled from the same surface that carries the
 * invite gate.
 */
describe("the site banner flag", () => {
  it("reports whether the strip is on", async () => {
    const { app, access } = build({ roles: ["admin"], permissions: ["flags.write"] });

    const response = await app.inject({ method: "GET", url: "/api/v1/admin/site-banner", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true });
    expect(access.isSiteBanner).toHaveBeenCalled();
    await app.close();
  });

  it("turns it off, and says who did", async () => {
    const { app, access, admin } = build({ roles: ["admin"], permissions: ["flags.write"] });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/site-banner",
      headers: AS_ADMIN,
      payload: { enabled: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: false });
    expect(access.setSiteBanner).toHaveBeenCalledWith(false, "u-admin");
    // Audited: turning off the only thing advertising a live campaign is a
    // change somebody will later want the author and the hour of.
    expect(admin.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "site_banner.changed", before: { enabled: true }, after: { enabled: false } }),
    );
    await app.close();
  });

  /**
   * Read is gated too, unlike the invite gate's.
   *
   * There is no `flags.read`, and inventing one for a value already public on
   * `GET /content` would be ceremony — but that means support staff get a 403
   * on the read rather than the 200 they get for early access, so it is worth
   * pinning rather than discovering.
   */
  it("needs flags.write for both halves", async () => {
    const { app } = build({ roles: ["support"], permissions: ["invites.read"] });

    const read = await app.inject({ method: "GET", url: "/api/v1/admin/site-banner", headers: AS_ADMIN });
    const write = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/site-banner",
      headers: AS_ADMIN,
      payload: { enabled: false },
    });

    expect(read.statusCode).toBe(403);
    expect(write.statusCode).toBe(403);
    await app.close();
  });

  it("refuses a body the schema does not name", async () => {
    const { app, access } = build({ roles: ["admin"], permissions: ["flags.write"] });

    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/admin/site-banner",
      headers: AS_ADMIN,
      payload: { enabled: false, code: "site_banner_but_actually_something_else" },
    });

    expect(response.statusCode).toBe(400);
    expect(access.setSiteBanner).not.toHaveBeenCalled();
    await app.close();
  });
});
