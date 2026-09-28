import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAccessRepository } from "./accessRepository";
import { PostgresAuthRepository } from "./authRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const PEPPER = "test-pepper";
const auth = (tx: Sql) => new PostgresAuthRepository(tx, PEPPER);

/**
 * The way back in.
 *
 * A reset link is a password until it expires, so the tests worth writing are
 * the ones about it ceasing to work: once used, once expired, once replaced.
 * All of them go through the repository rather than the form, because the
 * form is not what somebody attacking this would use.
 */
describe("resetting a forgotten password", () => {
  /** Signs somebody up and hands back their address and a live token. */
  async function askForReset(tx: Sql, email = "forgot@example.com") {
    const repo = auth(tx);
    // Signup is gated, so getting an account to forget the password of needs
    // a code first.
    await new PostgresAccessRepository(tx).createInvite({ code: "reset-gate" });
    await repo.registerWithPassword(email, "the-first-password", "forgetful", { inviteCode: "reset-gate" });
    const started = await repo.startPasswordReset(email, { ip: "203.0.113.9", userAgent: "vitest" });
    if (started.kind !== "sent") throw new Error(`expected a token, got ${started.kind}`);
    return { repo, email, token: started.token, userId: started.userId };
  }

  it("changes the password and refuses the old one afterwards", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, email, token } = await askForReset(tx);

      await repo.completePasswordReset(token, "a-brand-new-password");

      const user = await repo.loginWithPassword(email, "a-brand-new-password");
      expect(user.handle).toBe("forgetful");
      await expect(repo.loginWithPassword(email, "the-first-password")).rejects.toMatchObject({
        code: "invalid_credentials",
      });
    });
  });

  it("will not spend the same link twice", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, token } = await askForReset(tx);
      await repo.completePasswordReset(token, "a-brand-new-password");

      // Somebody re-opening the mail, or a forwarded copy of it.
      await expect(repo.completePasswordReset(token, "a-third-password")).rejects.toMatchObject({ code: "reset_used" });
      expect(await repo.checkPasswordReset(token)).toBe("used");
    });
  });

  it("refuses a link that has run out of time", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, token } = await askForReset(tx);
      await tx`update auth_tokens set expires_at = now() - interval '1 minute' where purpose = 'password_reset'`;

      expect(await repo.checkPasswordReset(token)).toBe("expired");
      await expect(repo.completePasswordReset(token, "a-brand-new-password")).rejects.toMatchObject({
        code: "reset_expired",
      });
    });
  });

  it("leaves one live link however many times it is asked for", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, email, token: first } = await askForReset(tx);
      const second = await repo.startPasswordReset(email);
      if (second.kind !== "sent") throw new Error("expected a second token");

      /* A forwarded older mail stops working the moment a newer one is asked
         for, so a link left in an inbox is not a spare key. */
      expect(await repo.checkPasswordReset(first)).toBe("used");
      expect(await repo.checkPasswordReset(second.token)).toBe("usable");
    });
  });

  it("signs every other device out", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, token, userId } = await askForReset(tx);
      const phone = await repo.createSession(userId);
      const laptop = await repo.createSession(userId);

      await repo.completePasswordReset(token, "a-brand-new-password");

      // The reason for a reset is often that somebody else is already inside.
      expect(await repo.resolveSession(phone.token)).toBeNull();
      expect(await repo.resolveSession(laptop.token)).toBeNull();
    });
  });

  it("says nothing useful about a token it never minted", async () => {
    await inRollback(sql, async (tx) => {
      const repo = auth(tx);

      expect(await repo.checkPasswordReset("not-a-token-we-ever-minted")).toBe("unknown");
      await expect(repo.completePasswordReset("not-a-token-we-ever-minted", "a-brand-new-password")).rejects.toMatchObject({
        code: "reset_invalid",
      });
    });
  });

  it("will not open the password door with a token minted for something else", async () => {
    await inRollback(sql, async (tx) => {
      const { repo, userId, token } = await askForReset(tx);
      /* `auth_tokens` carries four purposes. A magic-link row is a perfectly
         valid row in the same table with the same hash column, so `purpose`
         has to be part of every lookup — not just of the insert. */
      await tx`
        update auth_tokens set purpose = 'magic_link' where user_id = ${userId} and purpose = 'password_reset'
      `;

      expect(await repo.checkPasswordReset(token)).toBe("unknown");
      await expect(repo.completePasswordReset(token, "a-brand-new-password")).rejects.toMatchObject({
        code: "reset_invalid",
      });
    });
  });

  it("tells a missing address and a passwordless account apart", async () => {
    await inRollback(sql, async (tx) => {
      const repo = auth(tx);
      const [account] = await tx<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
      await tx`insert into users (email, handle, personal_account_id) values ('google@example.com', 'googler', ${account!.id})`;
      await tx`
        insert into auth_identities (user_id, provider, provider_uid, email)
        select id, 'google', 'uid-1', email from users where email = 'google@example.com'
      `;

      expect(await repo.startPasswordReset("nobody@example.com")).toEqual({ kind: "no_account" });
      expect(await repo.startPasswordReset("google@example.com")).toMatchObject({ kind: "other_method", method: "oauth" });

      // No token is minted for a password that does not exist.
      const [row] = await tx<{ n: number }[]>`select count(*)::int as n from auth_tokens where purpose = 'password_reset'`;
      expect(row!.n).toBe(0);
    });
  });

  it("records where the link was asked from", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await askForReset(tx);

      // The table has carried these columns since 0005 and they are the only
      // record of who asked, so they are filled rather than left null.
      const [row] = await tx<{ ip: string | null; user_agent: string | null }[]>`
        select host(ip) as ip, user_agent from auth_tokens where user_id = ${userId} and purpose = 'password_reset'
      `;
      expect([row?.ip, row?.user_agent]).toEqual(["203.0.113.9", "vitest"]);
    });
  });
});
