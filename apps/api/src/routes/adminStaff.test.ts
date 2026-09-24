import Fastify, { type FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerErrorHandling } from "../plugins/errors";
import { registerAdminStaffRoutes } from "./adminStaff";

/* ---------------------------------------------------------------------------
   Appointing staff, and the four rules that keep it from being an escalation.

     1. You cannot grant what you do not hold.
     2. You cannot touch somebody who holds what you do not. Rule 1 stops a
        limited admin *granting* `*`; on its own it says nothing about them
        taking `*` away from the person who has it, or handing that person's
        role to themselves.
     3. You cannot touch somebody ranked above you, or appoint to a role above
        your own. Rule 2 compares permission sets and therefore says nothing
        at all between two accounts that both hold `*` — which is every pair of
        admins, and was how any admin could revoke the owner.
     4. You cannot edit yourself — the others permit narrowing your own set,
        and the result is a console nobody can get back into.

   Every test here is one of those four, or the audit trail that proves which
   of them fired.
   --------------------------------------------------------------------------- */

const OWNER = { userId: "owner-1", permissions: ["*"], rank: 100 };
/* Holds everything the owner does. Rules 1 and 2 cannot tell them apart, which
   is the whole reason rank exists. */
const ADMIN = { userId: "admin-1", permissions: ["*"], rank: 50 };
const MODERATOR = { userId: "mod-1", permissions: ["community.read", "community.write"], rank: 20 };

const staffRow = (over: Partial<Record<string, unknown>> = {}) => ({
  userId: "target-1",
  email: "target@example.test",
  roleCode: "moderator",
  roleName: "Moderator",
  permissions: ["community.read"],
  isCustom: false,
  rank: 20,
  hasMfa: true,
  grantedAt: 0,
  grantedByEmail: null,
  ...over,
});

function appFor(
  actor: { userId: string; permissions: string[]; rank: number },
  members: ReturnType<typeof staffRow>[] = [staffRow()],
  known: { id: string; email: string | null } | null = { id: "target-1", email: "target@example.test" },
) {
  const audit = vi.fn(async () => {});
  const upsertStaff = vi.fn(async () => {});
  const appointStaff = vi.fn(async (input: { existingUserId: string | null }) => ({
    userId: input.existingUserId ?? "new-1",
    totp: input.existingUserId ? null : { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/DEEV:x?secret=JBSWY3DPEHPK3PXP" },
  }));
  const revokeStaff = vi.fn(async () => true);
  const grant = vi.fn(async () => ({ outcome: "granted", grant: { coins: 500, endsAt: 1 } }) as never);
  const revoke = vi.fn(async () => ({ outcome: "revoked" as const, coinsWithdrawn: 5 }));

  const guard = {
    require: vi.fn(async (_request: unknown, reply: never, permission: string) => {
      // The permission gate itself is tested in admin.test.ts; here every actor
      // is assumed past it so the subject under test is the ranking rules.
      void permission;
      void reply;
      return { ...actor, roles: ["admin"], mfaVerified: true, email: null, sessionId: "s1", hasMfa: true } as never;
    }),
    audit,
  };

  const app = Fastify({ logger: false });
  registerErrorHandling(app);
  registerAdminStaffRoutes(
    app,
    {
      staff: {
        listStaff: vi.fn(async () => members as never),
        staffMember: vi.fn(async (userId: string) => (members.find((m) => m.userId === userId) ?? null) as never),
        upsertStaff,
        appointStaff,
        revokeStaff,
        roles: vi.fn(async () => [
          { code: "owner", name: "Owner", permissions: ["*"], rank: 100 },
          { code: "admin", name: "Administrator", permissions: ["*"], rank: 50 },
          { code: "moderator", name: "Moderator", permissions: ["community.read", "community.write"], rank: 20 },
        ]),
        findUserByEmail: vi.fn(async () => known),
      },
      planGrants: { activeFor: vi.fn(async () => null), grant, revoke },
      accountForUser: vi.fn(async () => "account-1"),
    },
    guard as never,
  );
  return { app, audit, upsertStaff, appointStaff, revokeStaff, grant, revoke };
}

const appoint = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: "POST", url: "/api/v1/admin/staff", payload: payload as never });

describe("appointing staff", () => {
  it("gives somebody a role narrowed to a chosen set", async () => {
    const { app, appointStaff, audit } = appFor(OWNER, []);

    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", permissions: ["community.read"] });

    expect(response.statusCode).toBe(201);
    expect(appointStaff).toHaveBeenCalledWith(
      expect.objectContaining({ roleCode: "moderator", permissions: ["community.read"], grantedBy: "owner-1" }),
    );
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "staff.appointed" }));
  });

  it("inherits the role's own set when none is given", async () => {
    const { app, appointStaff } = appFor(OWNER, []);

    await appoint(app, { email: "new@example.test", roleCode: "moderator" });

    // Null, not a copy of the role's array: the row then tracks the role if
    // the role changes, which is what every pre-existing staff row does.
    expect(appointStaff).toHaveBeenCalledWith(expect.objectContaining({ permissions: null }));
  });

  /* Rule 1. */
  it("refuses to grant a permission the appointer does not hold", async () => {
    const { app, appointStaff } = appFor(MODERATOR, []);

    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", permissions: ["users.write"] });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "beyond_your_own" } });
    expect(appointStaff).not.toHaveBeenCalled();
  });

  /* Rule 1 again, by the back door: naming a role whose own set exceeds yours
     grants exactly the same access as listing its permissions out. */
  it("refuses a role whose permissions exceed the appointer's", async () => {
    const { app, appointStaff } = appFor(MODERATOR, []);

    const response = await appoint(app, { email: "new@example.test", roleCode: "admin" });

    expect(response.statusCode).toBe(403);
    expect(appointStaff).not.toHaveBeenCalled();
  });

  it("lets an admin delegate exactly what they hold", async () => {
    const { app, appointStaff } = appFor(MODERATOR, []);

    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", permissions: ["community.read"] });

    expect(response.statusCode).toBe(201);
    expect(appointStaff).toHaveBeenCalled();
  });

  it("refuses an address nobody signs in with when no password is given", async () => {
    const { app, appointStaff } = appFor(OWNER, [], null);

    const response = await appoint(app, { email: "stranger@example.test", roleCode: "moderator" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "no_such_user" } });
    expect(appointStaff).not.toHaveBeenCalled();
  });

  /* Staff are made by staff while signup is invite-only. */
  it("creates the account, with no invite, when a password is given for a new address", async () => {
    const { app, appointStaff, audit } = appFor(OWNER, [], null);

    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", password: "a-long-password" });

    expect(response.statusCode).toBe(201);
    expect(appointStaff).toHaveBeenCalledWith(
      expect.objectContaining({ existingUserId: null, email: "new@example.test", password: "a-long-password" }),
    );
    // The second-factor key goes back once, since /admin refuses a password alone.
    expect(response.json().totp.secret).toBe("JBSWY3DPEHPK3PXP");
    // And never into the audit log.
    const recorded = JSON.stringify((audit.mock.calls as unknown[][]).map((call) => call[2]));
    expect(recorded).toContain("accountCreated");
    expect(recorded).not.toContain("JBSWY3DPEHPK3PXP");
    expect(recorded).not.toContain("a-long-password");
  });

  /* Otherwise staff.write would be a way to take over any customer's account. */
  it("refuses a password for an address that already has an account", async () => {
    const { app, appointStaff } = appFor(OWNER, []);

    const response = await appoint(app, { email: "target@example.test", roleCode: "moderator", password: "a-long-password" });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "account_exists" } });
    expect(appointStaff).not.toHaveBeenCalled();
  });

  it("refuses a password too short to be one", async () => {
    const { app, appointStaff } = appFor(OWNER, [], null);

    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", password: "short" });

    expect(response.statusCode).toBe(400);
    expect(appointStaff).not.toHaveBeenCalled();
  });

  it("rejects a permission string that is not one", async () => {
    const { app, appointStaff } = appFor(OWNER, []);

    // The field is compared against every admin route in the system. A
    // language rich enough to be interesting is one where a typo grants more
    // than it reads as.
    const response = await appoint(app, { email: "new@example.test", roleCode: "moderator", permissions: ["../../etc/passwd"] });

    expect(response.statusCode).toBe(400);
    expect(appointStaff).not.toHaveBeenCalled();
  });
});

describe("changing what somebody can do", () => {
  const patch = (app: FastifyInstance, userId: string, payload: unknown) =>
    app.inject({ method: "PATCH", url: `/api/v1/admin/staff/${userId}`, payload: payload as never });

  /* Rule 2 — the one rule 1 does not cover. */
  it("refuses to change somebody who holds more than the actor", async () => {
    const { app, upsertStaff } = appFor(MODERATOR, [staffRow({ userId: "owner-2", permissions: ["*"] })]);

    const response = await patch(app, "owner-2", { permissions: ["community.read"] });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "outranked" } });
    expect(upsertStaff).not.toHaveBeenCalled();
  });

  /* Rule 3. */
  it("refuses to let anyone edit their own access", async () => {
    const { app, upsertStaff } = appFor(OWNER, [staffRow({ userId: "owner-1", permissions: ["*"] })]);

    const response = await patch(app, "owner-1", { permissions: [] });

    // Narrowing your own set is permitted by the first two rules and locks
    // everybody out of the console, including you.
    expect(response.statusCode).toBe(403);
    expect(upsertStaff).not.toHaveBeenCalled();
  });

  it("hands the role's set back when permissions are set to null", async () => {
    const { app, upsertStaff } = appFor(OWNER);

    const response = await patch(app, "target-1", { permissions: null });

    expect(response.statusCode).toBe(200);
    // Explicit null has to be distinguishable from omission: "give them the
    // role's set back" is a real instruction.
    expect(upsertStaff).toHaveBeenCalledWith(expect.objectContaining({ permissions: null }));
  });

  it("records what changed, both sides", async () => {
    const { app, audit } = appFor(OWNER);

    await patch(app, "target-1", { permissions: ["community.read", "community.write"] });

    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        action: "staff.permissions.changed",
        before: { permissions: ["community.read"] },
        after: { permissions: ["community.read", "community.write"] },
      }),
    );
  });
});

describe("removing staff", () => {
  const remove = (app: FastifyInstance, userId: string) => app.inject({ method: "DELETE", url: `/api/v1/admin/staff/${userId}` });

  it("takes the role away and audits it", async () => {
    const { app, revokeStaff, audit } = appFor(OWNER);

    const response = await remove(app, "target-1");

    expect(response.statusCode).toBe(200);
    expect(revokeStaff).toHaveBeenCalledWith("target-1", "moderator");
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "staff.revoked" }));
  });

  /* Rule 2, on the action that would matter most. */
  it("refuses to remove somebody more senior", async () => {
    const { app, revokeStaff } = appFor(MODERATOR, [staffRow({ userId: "owner-2", permissions: ["*"] })]);

    expect((await remove(app, "owner-2")).statusCode).toBe(403);
    expect(revokeStaff).not.toHaveBeenCalled();
  });

  /* Rule 3, on the action that would lock the door behind you. */
  it("refuses to let anyone remove themselves", async () => {
    const { app, revokeStaff } = appFor(OWNER, [staffRow({ userId: "owner-1", permissions: ["*"] })]);

    expect((await remove(app, "owner-1")).statusCode).toBe(403);
    expect(revokeStaff).not.toHaveBeenCalled();
  });
});

/* These used to live under /admin/staff and refuse anybody who held no role,
   which made comping a paying customer a hand-written INSERT over SSH. The
   repository underneath was never staff-specific; only the route was. */
describe("plans, for anybody", () => {
  const grantPlan = (app: FastifyInstance, userId: string, payload: unknown) =>
    app.inject({ method: "POST", url: `/api/v1/admin/users/${userId}/plan`, payload: payload as never });

  it("turns a plan on and writes down which one", async () => {
    const { app, grant, audit } = appFor(OWNER);

    const response = await grantPlan(app, "target-1", { planCode: "pro" });

    expect(response.statusCode).toBe(201);
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", planCode: "pro", grantedBy: "owner-1" }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "plan.granted" }));
  });

  /* Rule 2 applies here too: turning a plan on for somebody spends the
     company's capacity in their name, and a junior admin doing that to a
     senior one is the same overreach as editing their permissions. */
  it("refuses to grant a plan to somebody more senior", async () => {
    const { app, grant } = appFor(MODERATOR, [staffRow({ userId: "owner-2", permissions: ["*"] })]);

    expect((await grantPlan(app, "owner-2", { planCode: "pro" })).statusCode).toBe(403);
    expect(grant).not.toHaveBeenCalled();
  });

  it("refuses to stack a second plan, and says what is already there", async () => {
    const alreadyActive = appFor(OWNER);
    alreadyActive.grant.mockResolvedValueOnce({ outcome: "already_active", grant: { coins: 500 } } as never);

    const response = await grantPlan(alreadyActive.app, "target-1", { planCode: "pro" });

    // 409 rather than a silent success: pressing the button twice must not
    // hand out two terms' credits.
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: "already_active" } });
  });

  it("turns it off again and reports what was withdrawn", async () => {
    const { app, revoke, audit } = appFor(OWNER);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/users/target-1/plan" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ coinsWithdrawn: 5 });
    expect(revoke).toHaveBeenCalledWith("account-1", "owner-1");
    expect(audit).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ action: "plan.revoked" }));
  });

  /* The point of the change. A customer holds no role, so `staffMember` is
     null — which used to be a 404 and is now simply "nobody to outrank". */
  it("grants to a customer who holds no role at all", async () => {
    const { app, grant } = appFor(OWNER, []);

    const response = await grantPlan(app, "customer-1", { planCode: "pro" });

    expect(response.statusCode).toBe(201);
    expect(grant).toHaveBeenCalledWith(expect.objectContaining({ accountId: "account-1", planCode: "pro" }));
  });

  it("still refuses a customer with no personal account, which is a real 404", async () => {
    const audit = vi.fn(async () => {});
    const app = Fastify({ logger: false });
    registerErrorHandling(app);
    registerAdminStaffRoutes(
      app,
      {
        staff: {
          listStaff: vi.fn(async () => []),
          staffMember: vi.fn(async () => null),
          upsertStaff: vi.fn(async () => {}),
          appointStaff: vi.fn(async () => ({ userId: "x", totp: null })),
          revokeStaff: vi.fn(async () => true),
          roles: vi.fn(async () => []),
          findUserByEmail: vi.fn(async () => null),
        },
        planGrants: {
          activeFor: vi.fn(async () => null),
          grant: vi.fn(async () => ({ outcome: "granted" }) as never),
          revoke: vi.fn(async () => ({ outcome: "revoked" as const, coinsWithdrawn: 0 })),
        },
        accountForUser: vi.fn(async () => null),
      },
      { require: vi.fn(async () => OWNER as never), audit } as never,
    );

    const response = await grantPlan(app, "ghost-1", { planCode: "pro" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: "no_account" } });
    await app.close();
  });
});

/* Rule 3. Rank is the only one of the four that can separate two accounts
   holding `*`, which before migration 0035 meant any admin could remove the
   person the business belongs to. */
describe("rank", () => {
  const ownerRow = staffRow({
    userId: "owner-1",
    email: "owner@example.test",
    roleCode: "owner",
    roleName: "Owner",
    permissions: ["*"],
    rank: 100,
  });

  it("refuses an admin who tries to revoke the owner, though they hold the same permissions", async () => {
    const { app, revokeStaff } = appFor(ADMIN, [ownerRow]);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/staff/owner-1" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "outranked" } });
    expect(revokeStaff).not.toHaveBeenCalled();
  });

  it("refuses an admin narrowing the owner's access", async () => {
    const { app, upsertStaff } = appFor(ADMIN, [ownerRow]);

    const response = await app.inject({ method: "PATCH", url: "/api/v1/admin/staff/owner-1", payload: { permissions: [] } });

    expect(response.statusCode).toBe(403);
    expect(upsertStaff).not.toHaveBeenCalled();
  });

  it("refuses an admin minting an owner, which is the same move one step round", async () => {
    const { app, appointStaff } = appFor(ADMIN, [], null);

    const response = await appoint(app, { email: "new@example.test", roleCode: "owner", password: "a-long-password" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "role_above_you" } });
    expect(appointStaff).not.toHaveBeenCalled();
  });

  it("lets an owner appoint a second owner, which is how the role is handed on", async () => {
    const { app, appointStaff } = appFor(OWNER, [], null);

    const response = await appoint(app, { email: "new@example.test", roleCode: "owner", password: "a-long-password" });

    expect(response.statusCode).toBe(201);
    expect(appointStaff).toHaveBeenCalledWith(expect.objectContaining({ roleCode: "owner" }));
  });

  it("lets an owner act on an admin, because rank runs one way", async () => {
    const admin = staffRow({
      userId: "admin-1",
      email: "admin@example.test",
      roleCode: "admin",
      roleName: "Administrator",
      permissions: ["*"],
      rank: 50,
    });
    const { app, revokeStaff } = appFor(OWNER, [admin]);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/staff/admin-1" });

    expect(response.statusCode).toBe(200);
    expect(revokeStaff).toHaveBeenCalledWith("admin-1", "admin");
  });

  /* The lone owner needs no counter of its own: nobody outranks them, no
     second owner exists, and rule 4 stops them removing themselves. */
  it("leaves a lone owner unremovable without anything counting owners", async () => {
    const { app } = appFor(OWNER, [ownerRow]);

    const response = await app.inject({ method: "DELETE", url: "/api/v1/admin/staff/owner-1" });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: { code: "outranked" } });
  });
});
