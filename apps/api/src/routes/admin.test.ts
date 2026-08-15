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
  };
  const verifyPassword = vi.fn(async () => ({ id: "u-admin", emailNormalized: "admin@deev.test" }));

  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAdminRoutes(app, { admin: admin as never, access: access as never, verifyPassword }, { cookie: { secure: true } });
  return { app, admin, access, verifyPassword };
}

const AS_ADMIN = { cookie: "deev_admin=adm-tok" };

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
