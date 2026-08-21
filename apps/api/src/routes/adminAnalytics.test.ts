import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAdminRoutes } from "./admin";

/**
 * The money surface, and the customer list beside it.
 *
 * What is worth testing here is not the arithmetic — that belongs to the
 * repository's integration tests, against a real database. It is who is allowed
 * to see and do what, and whether the record of it survives.
 *
 * Two properties in particular:
 *
 *   1. **The customer list needs a second permission.** Aggregates need
 *      `analytics.read`; the list carries every customer's email beside what
 *      they spent and additionally needs `users.read`. Collapsing those means
 *      anybody who should see a chart also gets the mailing list, and that is
 *      not recoverable once granted.
 *   2. **Every mutation is audited before it answers.** Adjusting a balance and
 *      banning an account are the two most consequential things this panel does
 *      to a person, and `audit_log` is append-only at the database.
 */

const ADMIN = {
  sessionId: "s1",
  userId: "u-admin",
  email: "admin@deev.test",
  roles: ["admin"],
  permissions: ["*"],
  hasMfa: true,
  mfaVerified: true,
};

const USER_ID = "77777777-7777-4777-8777-777777777777";

const USER = {
  id: USER_ID,
  email: "customer@example.test",
  handle: "customer",
  displayName: "A Customer",
  createdAt: 1_780_000_000_000,
  coinsBalance: 120,
  coinsHeld: 0,
  coinsPurchased: 500,
  coinsSpent: 380,
  jobs: 40,
  providerCostUsd: 12.5,
  lastJobAt: 1_787_000_000_000,
  activeBans: 0,
  recentJobs: [],
  recentLedger: [],
};

function build(session: Partial<typeof ADMIN> | null = ADMIN) {
  const admin = {
    resolveSession: vi.fn(async (_token: string) => (session ? { ...ADMIN, ...session } : null)),
    recordAudit: vi.fn(async () => undefined),
  };
  const analytics = {
    overview: vi.fn(async () => ({
      coinsSold: 2400,
      coinsGranted: 300,
      coinsSpent: 1800,
      revenueIrr: 0,
      revenueUsd: 0,
      providerCostUsd: 12.5,
      grossMarginUsd: null,
      jobs: 40,
      jobsSucceeded: 38,
      jobsFailed: 2,
      activeUsers: 6,
      newUsers: 3,
    })),
    standing: vi.fn(async () => ({ coinsOutstanding: 900, coinsHeld: 20, users: 11, bannedUsers: 1 })),
    daily: vi.fn(async () => []),
    models: vi.fn(async () => []),
    providers: vi.fn(async () => []),
    users: vi.fn(async () => ({ users: [USER], total: 1 })),
    user: vi.fn(async (id: string) => (id === USER_ID ? USER : null)),
    adjustCredits: vi.fn(async () => undefined),
    revokeSessions: vi.fn(async () => 2),
  };
  const bans = {
    listActive: vi.fn(async () => []),
    create: vi.fn(async () => ({
      id: "b1",
      userId: USER_ID,
      scope: "generation" as const,
      reason: null,
      createdBy: "u-admin",
      createdAt: 1,
      expiresAt: null,
    })),
    lift: vi.fn(async () => true),
  };

  const app: FastifyInstance = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAdminRoutes(
    app,
    {
      admin: admin as never,
      access: {} as never,
      verifyPassword: vi.fn() as never,
      analytics: { analytics: analytics as never, bans: bans as never },
    },
    { cookie: { secure: true } },
  );
  return { app, admin, analytics, bans };
}

const AS_ADMIN = { cookie: "deev_admin=adm-tok" };

describe("reaching the analytics surface", () => {
  it("answers 404 with no staff session, not 401", async () => {
    const { app } = build(null);
    // The whole staff surface denies its own existence to a stranger.
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview", headers: AS_ADMIN })).statusCode).toBe(404);
    await app.close();
  });

  it("refuses a session that has not passed its second factor", async () => {
    const { app, analytics } = build({ mfaVerified: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview", headers: AS_ADMIN });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("mfa_required");
    expect(analytics.overview).not.toHaveBeenCalled();
    await app.close();
  });

  it("defaults to thirty days and honours a window it is given", async () => {
    const { app, analytics } = build();
    await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview", headers: AS_ADMIN });
    expect(analytics.overview).toHaveBeenCalledWith("30d");

    await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview?window=today", headers: AS_ADMIN });
    expect(analytics.overview).toHaveBeenCalledWith("today");
    await app.close();
  });

  it("refuses a window it does not know rather than quietly picking one", async () => {
    const { app } = build();
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview?window=forever", headers: AS_ADMIN });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("the customer list needs a second permission", () => {
  it("gives the charts to analytics.read and refuses the list", async () => {
    const { app, analytics } = build({ roles: ["analyst"], permissions: ["analytics.read"] });

    const charts = await app.inject({ method: "GET", url: "/api/v1/admin/analytics/overview", headers: AS_ADMIN });
    const list = await app.inject({ method: "GET", url: "/api/v1/admin/users", headers: AS_ADMIN });

    expect(charts.statusCode).toBe(200);
    // 403 rather than 404: this caller demonstrably has a staff session, so
    // denying the surface exists would be a lie told to somebody already inside.
    expect(list.statusCode).toBe(403);
    expect(analytics.users).not.toHaveBeenCalled();
    await app.close();
  });

  it("allows the list once both are held", async () => {
    const { app, analytics } = build({ roles: ["support"], permissions: ["analytics.read", "users.read"] });
    const response = await app.inject({ method: "GET", url: "/api/v1/admin/users?search=cust&sort=balance", headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(analytics.users).toHaveBeenCalledWith(expect.objectContaining({ search: "cust", sort: "balance" }));
    await app.close();
  });

  it("caps how many rows one request can ask for", async () => {
    const { app } = build();
    // "Give me every customer" should not be something one mistyped
    // querystring can ask of a table that will grow.
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/users?limit=5000", headers: AS_ADMIN })).statusCode).toBe(400);
    await app.close();
  });

  it("answers 404 for a customer who is not there", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/admin/users/00000000-0000-4000-8000-000000000000",
      headers: AS_ADMIN,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("adjusting a balance", () => {
  it("needs credits.grant, which reading the dashboard does not give", async () => {
    const { app, analytics } = build({ roles: ["analyst"], permissions: ["analytics.read", "users.read"] });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/credits`,
      headers: AS_ADMIN,
      payload: { coins: 50, note: "goodwill" },
    });

    expect(response.statusCode).toBe(403);
    expect(analytics.adjustCredits).not.toHaveBeenCalled();
    await app.close();
  });

  it("insists on a reason, because the ledger cannot be edited afterwards", async () => {
    const { app, analytics } = build();
    const noNote = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/credits`,
      headers: AS_ADMIN,
      payload: { coins: 50 },
    });
    const nothingToDo = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/credits`,
      headers: AS_ADMIN,
      payload: { coins: 0, note: "a note" },
    });

    expect(noNote.statusCode).toBe(400);
    expect(nothingToDo.statusCode).toBe(400);
    expect(analytics.adjustCredits).not.toHaveBeenCalled();
    await app.close();
  });

  it("records the before and after, and the reason, in the audit log", async () => {
    const { app, admin } = build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/credits`,
      headers: AS_ADMIN,
      payload: { coins: -30, note: "duplicate grant, reversing" },
    });

    expect(response.statusCode).toBe(200);
    expect(admin.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "credits.adjusted",
        targetId: USER_ID,
        after: expect.objectContaining({ delta: -30, note: "duplicate grant, reversing" }),
      }),
    );
    await app.close();
  });

  it("turns the database's refusal to overdraw into a 409", async () => {
    const { app, analytics } = build();
    // `adjust_credits` refuses rather than clamping; a 500 here would make a
    // well-formed request look like an outage.
    analytics.adjustCredits.mockRejectedValueOnce(
      Object.assign(new Error("adjust_credits: cannot remove 500000000 from a spendable balance of 10000000"), { code: "23514" }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/credits`,
      headers: AS_ADMIN,
      payload: { coins: -500, note: "too much" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("insufficient_credits");
    await app.close();
  });
});

describe("banning and unbanning", () => {
  it("needs users.write", async () => {
    const { app, bans } = build({ roles: ["analyst"], permissions: ["analytics.read", "users.read", "credits.grant"] });
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/bans`,
      headers: AS_ADMIN,
      payload: { scope: "generation" },
    });

    expect(response.statusCode).toBe(403);
    expect(bans.create).not.toHaveBeenCalled();
    await app.close();
  });

  it("refuses a scope the database would not accept", async () => {
    const { app, bans } = build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/bans`,
      headers: AS_ADMIN,
      payload: { scope: "everything" },
    });

    expect(response.statusCode).toBe(400);
    expect(bans.create).not.toHaveBeenCalled();
    await app.close();
  });

  it("creates the ban and audits it", async () => {
    const { app, bans, admin } = build();
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/admin/users/${USER_ID}/bans`,
      headers: AS_ADMIN,
      payload: { scope: "generation", reason: "chargebacks" },
    });

    expect(response.statusCode).toBe(201);
    expect(bans.create).toHaveBeenCalledWith(expect.objectContaining({ scope: "generation", reason: "chargebacks", createdBy: "u-admin" }));
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.banned" }));
    await app.close();
  });

  it("answers 404 when there was no ban to lift", async () => {
    const { app, bans } = build();
    bans.lift.mockResolvedValueOnce(false);

    const response = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${USER_ID}/bans/b1`, headers: AS_ADMIN });

    // The caller believed there was one. A cheerful 200 would leave them
    // thinking they had undone something.
    expect(response.statusCode).toBe(404);
    await app.close();
  });
});

describe("ending someone's sessions", () => {
  it("needs users.write and reports how many it closed", async () => {
    const refused = build({ roles: ["support"], permissions: ["analytics.read", "users.read"] });
    expect(
      (await refused.app.inject({ method: "DELETE", url: `/api/v1/admin/users/${USER_ID}/sessions`, headers: AS_ADMIN })).statusCode,
    ).toBe(403);
    await refused.app.close();

    const { app, admin } = build();
    const response = await app.inject({ method: "DELETE", url: `/api/v1/admin/users/${USER_ID}/sessions`, headers: AS_ADMIN });

    expect(response.statusCode).toBe(200);
    expect(response.json().revoked).toBe(2);
    expect(admin.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "user.sessions_revoked" }));
    await app.close();
  });
});
