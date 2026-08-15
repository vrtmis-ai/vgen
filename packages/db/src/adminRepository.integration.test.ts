import { sealingKeyFrom, totpCode } from "@vgen/core";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAdminRepository, grantsPermission } from "./adminRepository";
import { connect, expectDbError, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;
const key = sealingKeyFrom("integration-test-key");
const repo = (tx: Sql) => new PostgresAdminRepository(tx, key);

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

describe("permission matching", () => {
  it("accepts an exact grant, a section wildcard and the full wildcard", () => {
    expect(grantsPermission(["invites.read"], "invites.read")).toBe(true);
    expect(grantsPermission(["invites.*"], "invites.write")).toBe(true);
    expect(grantsPermission(["*"], "anything.at.all")).toBe(true);
  });

  it("does not let one section's wildcard reach another", () => {
    // The bug this guards: a prefix check without the dot would make
    // "invites.*" match "invitesecret.read".
    expect(grantsPermission(["invites.*"], "promos.write")).toBe(false);
    expect(grantsPermission(["invites.*"], "invitesecret.read")).toBe(false);
    expect(grantsPermission(["invites.read"], "invites.write")).toBe(false);
    expect(grantsPermission([], "invites.read")).toBe(false);
  });
});

describe("staff identity", () => {
  it("is nobody until a role beyond 'user' is granted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);

      expect(await admin.resolvePrincipal(userId)).toBeNull();

      await tx`insert into user_roles (user_id, role_code) values (${userId}, 'user')`;
      expect(await admin.resolvePrincipal(userId)).toBeNull();

      await admin.grantRole(userId, "admin", null);
      const principal = await admin.resolvePrincipal(userId);
      expect(principal).toMatchObject({ roles: ["admin"], permissions: ["*"], hasMfa: false });
    });
  });

  it("reflects a revoked role on the very next request", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      await admin.grantRole(userId, "admin", null);

      await tx`delete from user_roles where user_id = ${userId}`;
      // Permissions are re-read rather than cached into the session, so this
      // does not wait for the session to expire.
      expect(await admin.resolvePrincipal(userId)).toBeNull();
    });
  });
});

describe("the second factor", () => {
  it("stays unconfirmed until a real code proves it, then issues recovery codes", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      await admin.grantRole(userId, "admin", null);

      const { secret } = await admin.beginTotpEnrolment(userId, "admin@deev.test");
      // Enrolment started but unconfirmed must not count as a second factor.
      expect((await admin.resolvePrincipal(userId))?.hasMfa).toBe(false);

      const codes = await admin.confirmTotpEnrolment(userId, totpCode(secret));
      expect(codes).toHaveLength(10);
      expect((await admin.resolvePrincipal(userId))?.hasMfa).toBe(true);
    });
  });

  it("never stores the secret in the clear", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const { secret } = await repo(tx).beginTotpEnrolment(userId, "admin@deev.test");

      const [row] = await tx<{ secret_ref: string }[]>`select secret_ref from mfa_credentials where user_id = ${userId}`;
      expect(row?.secret_ref).not.toContain(secret);
      expect(row?.secret_ref.startsWith("v1.")).toBe(true);
    });
  });

  it("accepts a recovery code exactly once", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      const { secret } = await admin.beginTotpEnrolment(userId, "admin@deev.test");
      const [recovery] = await admin.confirmTotpEnrolment(userId, totpCode(secret));

      expect(await admin.verifySecondFactor(userId, recovery!)).toBe(true);
      expect(await admin.verifySecondFactor(userId, recovery!)).toBe(false);
    });
  });

  it("refuses another account's code", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      const admin = repo(tx);
      const { secret } = await admin.beginTotpEnrolment(mine.userId, "a@deev.test");
      await admin.confirmTotpEnrolment(mine.userId, totpCode(secret));
      const other = await admin.beginTotpEnrolment(theirs.userId, "b@deev.test");
      await admin.confirmTotpEnrolment(theirs.userId, totpCode(other.secret));

      expect(await admin.verifySecondFactor(mine.userId, totpCode(other.secret))).toBe(false);
    });
  });

  it("replaces the old recovery codes when the factor is rotated", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      const first = await admin.beginTotpEnrolment(userId, "admin@deev.test");
      const [oldRecovery] = await admin.confirmTotpEnrolment(userId, totpCode(first.secret));

      const second = await admin.beginTotpEnrolment(userId, "admin@deev.test");
      await admin.confirmTotpEnrolment(userId, totpCode(second.secret));

      // A rotated second factor that is still bypassable with the previous
      // recovery set is not rotated.
      expect(await admin.verifySecondFactor(userId, oldRecovery!)).toBe(false);
    });
  });
});

describe("staff sessions", () => {
  it("authorises nothing until MFA is marked, and never stores the token", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      await admin.grantRole(userId, "admin", null);
      const { token } = await admin.createSession(userId, "1.2.3.4", "test");

      expect(await admin.resolveSession(token)).toMatchObject({ mfaVerified: false, permissions: ["*"] });
      const [row] = await tx<{ token_hash: string }[]>`select token_hash from admin_sessions where user_id = ${userId}`;
      expect(row?.token_hash).not.toBe(token);

      await admin.markSessionMfaVerified(token);
      expect(await admin.resolveSession(token)).toMatchObject({ mfaVerified: true });
    });
  });

  it("stops resolving once revoked or expired", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      await admin.grantRole(userId, "admin", null);

      const live = await admin.createSession(userId);
      await admin.revokeSession(live.token);
      expect(await admin.resolveSession(live.token)).toBeNull();

      const stale = await admin.createSession(userId);
      await tx`update admin_sessions set expires_at = now() - interval '1 hour' where user_id = ${userId}`;
      expect(await admin.resolveSession(stale.token)).toBeNull();
    });
  });
});

describe("the audit trail", () => {
  it("records the actor, the target and both states", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);

      await admin.recordAudit({
        actorUserId: userId,
        actorRole: "admin",
        action: "invite.revoked",
        targetType: "invite_code",
        before: { isUsable: true },
        after: { isUsable: false },
        ip: "1.2.3.4",
      });

      const [row] = await tx<{ action: string; before_state: unknown; after_state: unknown }[]>`
        select action, before_state, after_state from audit_log where actor_user_id = ${userId}
      `;
      expect(row).toMatchObject({ action: "invite.revoked", before_state: { isUsable: true }, after_state: { isUsable: false } });
    });
  });

  it("cannot be edited or emptied afterwards", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await repo(tx).recordAudit({ actorUserId: userId, action: "invite.created" });

      // The point of the trail: the person who made the change cannot tidy it.
      // These raise rather than silently doing nothing, so an attempt is visible.
      const edit = await expectDbError(tx, () => tx`update audit_log set action = 'nothing' where actor_user_id = ${userId}`);
      expect(edit.message).toMatch(/append-only/);
      const remove = await expectDbError(tx, () => tx`delete from audit_log where actor_user_id = ${userId}`);
      expect(remove.message).toMatch(/append-only/);

      const [row] = await tx<{ action: string }[]>`select action from audit_log where actor_user_id = ${userId}`;
      expect(row?.action).toBe("invite.created");
    });
  });

  it("keeps v_admins_without_mfa empty once everyone has enrolled", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      const admin = repo(tx);
      await admin.grantRole(userId, "admin", null);

      expect((await admin.adminsWithoutMfa()).some((row) => row.userId === userId)).toBe(true);

      const { secret } = await admin.beginTotpEnrolment(userId, "admin@deev.test");
      await admin.confirmTotpEnrolment(userId, totpCode(secret));
      expect((await admin.adminsWithoutMfa()).some((row) => row.userId === userId)).toBe(false);
    });
  });
});
