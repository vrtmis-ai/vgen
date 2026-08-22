import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAccessRepository } from "./accessRepository";
import { AuthError, PostgresAuthRepository, TRIAL_COINS } from "./authRepository";
import { COIN, connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const PEPPER = "test-pepper";
const auth = (tx: Sql) => new PostgresAuthRepository(tx, PEPPER);
const phone = (suffix: string) => `+98912${suffix.padStart(7, "0")}`;

/** Signup is gated by default, so most tests need a code to get through it. */
async function usableInvite(tx: Sql, code: string, grantCoins = 0): Promise<string> {
  await new PostgresAccessRepository(tx).createInvite({ code, grantCoins });
  return code;
}

describe("the early access gate", () => {
  it("refuses a signup with no invite while the gate is up", async () => {
    await inRollback(sql, async (tx) => {
      await expect(auth(tx).signInWithPhone(phone("1"))).rejects.toMatchObject({ code: "invite_required" });
    });
  });

  it("admits a signup carrying a valid invite", async () => {
    await inRollback(sql, async (tx) => {
      const code = await usableInvite(tx, "gate-open");
      const user = await auth(tx).signInWithPhone(phone("2"), { inviteCode: code });
      expect(user.id).toBeTruthy();
    });
  });

  it("refuses an invalid invite rather than creating the account anyway", async () => {
    await inRollback(sql, async (tx) => {
      await expect(auth(tx).signInWithPhone(phone("3"), { inviteCode: "no-such-code" })).rejects.toMatchObject({
        code: "invite_invalid",
      });
      const [count] = await tx<{ count: string }[]>`select count(*)::text as count from users where phone = ${phone("3")}`;
      expect(Number(count?.count)).toBe(0);
    });
  });

  it("lets anyone in once early access is switched off", async () => {
    await inRollback(sql, async (tx) => {
      await new PostgresAccessRepository(tx).setEarlyAccess(false, null);
      const user = await auth(tx).signInWithPhone(phone("4"));
      expect(user.id).toBeTruthy();
    });
  });
});

describe("phone sign-in", () => {
  it("accepts the code it issued", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("10");
      const { code } = await repository.startPhoneVerification(number, "1.2.3.4");

      await expect(repository.verifyPhoneCode(number, code)).resolves.toBeUndefined();
      // Checking a code no longer spends it, so asking twice is allowed. What
      // spends it is signing in — see "spends the code once the sign-in
      // actually happens". The two came apart because being told an invite is
      // needed used to destroy the code needed to supply one.
      await expect(repository.verifyPhoneCode(number, code)).resolves.toBeUndefined();
    });
  });

  it("counts wrong guesses and stops accepting them", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("11");
      const { code } = await repository.startPhoneVerification(number);

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(repository.verifyPhoneCode(number, "000000")).rejects.toMatchObject({ code: "otp_invalid" });
      }
      // Even the right code is refused once the budget is spent, so guessing is
      // bounded by the row and not only by the rate limiter.
      await expect(repository.verifyPhoneCode(number, code)).rejects.toMatchObject({ code: "otp_exhausted" });
    });
  });

  // The bug this pair exists to stop coming back: the 403 that asks for an
  // invite used to be the same request that destroyed the code needed to
  // supply one, so every invite-gated phone signup dead-ended on "that code is
  // not right" about a code the user had typed correctly.
  it("does not spend the code when the signup is refused for want of an invite", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("13");
      const { code } = await repository.startPhoneVerification(number);

      await expect(repository.signInWithPhoneCode(number, code)).rejects.toMatchObject({ code: "invite_required" });

      const invite = await usableInvite(tx, "second-try");
      const user = await repository.signInWithPhoneCode(number, code, { inviteCode: invite });
      expect(user.id).toBeTruthy();
    });
  });

  it("does not spend the code when the invite turns out to be invalid either", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("14");
      const { code } = await repository.startPhoneVerification(number);

      await expect(repository.signInWithPhoneCode(number, code, { inviteCode: "no-such-code" })).rejects.toMatchObject({
        code: "invite_invalid",
      });

      const invite = await usableInvite(tx, "the-real-one");
      await expect(repository.signInWithPhoneCode(number, code, { inviteCode: invite })).resolves.toMatchObject({
        id: expect.any(String),
      });
    });
  });

  // The other half of the same guarantee. Releasing the code on a failed
  // signup must not turn into never spending it at all.
  it("spends the code once the sign-in actually happens", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("15");
      const invite = await usableInvite(tx, "spend-once");
      const { code } = await repository.startPhoneVerification(number);

      await repository.signInWithPhoneCode(number, code, { inviteCode: invite });

      await expect(repository.signInWithPhoneCode(number, code)).rejects.toMatchObject({ code: "otp_invalid" });
    });
  });

  // A refused signup still costs an attempt. The counter is what bounds
  // guessing, so it must survive the rollback that releases the code.
  it("still counts the attempt when the signup is rolled back", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("16");
      const { code } = await repository.startPhoneVerification(number);

      await expect(repository.signInWithPhoneCode(number, code)).rejects.toMatchObject({ code: "invite_required" });

      const [row] = await tx<{ attempts: number }[]>`
        select attempts from phone_verifications where phone = ${number} order by sent_at desc limit 1
      `;
      expect(row?.attempts).toBe(1);
    });
  });

  it("refuses an expired code", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const number = phone("12");
      const { code } = await repository.startPhoneVerification(number);
      await tx`update phone_verifications set expires_at = now() - interval '1 minute' where phone = ${number}`;

      await expect(repository.verifyPhoneCode(number, code)).rejects.toMatchObject({ code: "otp_expired" });
    });
  });

  it("returns the same account the second time the number signs in", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "returning-user");
      const number = phone("13");

      const first = await repository.signInWithPhone(number, { inviteCode: code });
      const second = await repository.signInWithPhone(number);
      expect(second.id).toBe(first.id);
    });
  });
});

describe("the free trial", () => {
  it("grants once per phone number and survives the account being deleted", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "trial-once");
      const number = phone("20");

      const user = await repository.signInWithPhone(number, { inviteCode: code });
      const [balance] = await tx<{ micro_credits: string }[]>`
        select ab.micro_credits::text from account_balances ab
        join users u on u.personal_account_id = ab.account_id where u.id = ${user.id}
      `;
      expect(Number(balance?.micro_credits)).toBe(TRIAL_COINS * COIN);

      // Delete the account through the path the schema actually supports —
      // anonymise rather than erase, which nulls the phone — then come back
      // with the same number and expect a genuinely new account.
      await tx`select anonymize_user(${user.id})`;
      const second = await usableInvite(tx, "trial-once-again");
      const returning = await repository.signInWithPhone(number, { inviteCode: second });
      expect(returning.id).not.toBe(user.id);

      const [again] = await tx<{ micro_credits: string }[]>`
        select ab.micro_credits::text from account_balances ab
        join users u on u.personal_account_id = ab.account_id where u.id = ${returning.id}
      `;
      // trial_grants is keyed by the phone hash and is not cascaded from users,
      // so the second account gets nothing.
      expect(Number(again?.micro_credits ?? 0)).toBe(0);
    });
  });

  it("stacks invite credit on top of the trial", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "generous-campaign", 20);
      const user = await repository.signInWithPhone(phone("21"), { inviteCode: code });

      const [balance] = await tx<{ micro_credits: string }[]>`
        select ab.micro_credits::text from account_balances ab
        join users u on u.personal_account_id = ab.account_id where u.id = ${user.id}
      `;
      expect(Number(balance?.micro_credits)).toBe((TRIAL_COINS + 20) * COIN);
    });
  });
});

describe("email and password", () => {
  it("registers, then logs in with the same password and no other", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "password-user");

      const created = await repository.registerWithPassword("person@example.test", "a good long password", {
        inviteCode: code,
      });
      const loggedIn = await repository.loginWithPassword("person@example.test", "a good long password");
      expect(loggedIn.id).toBe(created.id);

      await expect(repository.loginWithPassword("person@example.test", "wrong password")).rejects.toMatchObject({
        code: "invalid_credentials",
      });
    });
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    await inRollback(sql, async (tx) => {
      // Otherwise the endpoint tells an attacker which addresses have accounts.
      const error = await auth(tx)
        .loginWithPassword("nobody@example.test", "some password")
        .catch((caught: unknown) => caught as AuthError);
      expect(error).toMatchObject({ code: "invalid_credentials" });
    });
  });

  it("refuses a second account on the same address", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "one-per-email");
      await repository.registerWithPassword("taken@example.test", "a good long password", { inviteCode: code });

      const second = await usableInvite(tx, "one-per-email-2");
      await expect(
        repository.registerWithPassword("TAKEN@example.test", "another long password", { inviteCode: second }),
      ).rejects.toMatchObject({ code: "account_taken" });
    });
  });
});

describe("OAuth", () => {
  it("links a provider to the existing account with the same verified email", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "oauth-link");
      const existing = await repository.registerWithPassword("both@example.test", "a good long password", {
        inviteCode: code,
      });

      // Signing in with Google must not fork a second account and strand the
      // balance on the first.
      const viaGoogle = await repository.signInWithOAuth("google", "google-uid-1", "both@example.test", "Both");
      expect(viaGoogle.id).toBe(existing.id);

      const again = await repository.signInWithOAuth("google", "google-uid-1", "both@example.test", "Both");
      expect(again.id).toBe(existing.id);
    });
  });

  it("creates an account for a provider identity that is new", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "oauth-new");
      const user = await repository.signInWithOAuth("google", "google-uid-2", "fresh@example.test", "Fresh", {
        inviteCode: code,
      });
      expect(user.emailNormalized).toBe("fresh@example.test");
    });
  });
});

describe("sessions", () => {
  it("issues a token that resolves to its user and stops working when revoked", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-user");
      const user = await repository.signInWithPhone(phone("30"), { inviteCode: code });

      const { token } = await repository.createSession(user.id, "1.2.3.4", "test-agent");
      expect(await repository.resolveSession(token)).toMatchObject({ id: user.id });

      await repository.revokeSession(token);
      expect(await repository.resolveSession(token)).toBeNull();
    });
  });

  it("never stores the token itself", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-secret");
      const user = await repository.signInWithPhone(phone("31"), { inviteCode: code });
      const { token } = await repository.createSession(user.id);

      const [row] = await tx<{ token_hash: string }[]>`select token_hash from sessions where user_id = ${user.id}`;
      expect(row?.token_hash).not.toBe(token);
      expect(row?.token_hash).not.toContain(token);
    });
  });

  it("rejects an expired session and an invented token", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-expiry");
      const user = await repository.signInWithPhone(phone("32"), { inviteCode: code });
      const { token } = await repository.createSession(user.id);

      await tx`update sessions set expires_at = now() - interval '1 day' where user_id = ${user.id}`;
      expect(await repository.resolveSession(token)).toBeNull();
      expect(await repository.resolveSession("not-a-real-token")).toBeNull();
    });
  });

  /**
   * Reads were writes, and the write was the lookup.
   *
   * Every authenticated request stamped `last_used_at`, which meant a WAL
   * record per GET and — because the stamp took a row lock — requests sharing a
   * session queued behind one another. Measured at 445 requests a second on one
   * session against 2,329 on two hundred, on the same server.
   */
  it("does not write to the database on every read", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-touch");
      const user = await repository.signInWithPhone(phone("34"), { inviteCode: code });
      const { token } = await repository.createSession(user.id);

      const stampOf = async () => {
        const [row] = await tx<{ last_used_at: Date | null }[]>`
          select last_used_at from sessions where user_id = ${user.id}
        `;
        return row?.last_used_at?.getTime() ?? null;
      };

      expect(await repository.resolveSession(token)).toMatchObject({ id: user.id });
      const first = await stampOf();
      expect(first).not.toBeNull();

      // Resolving again must still answer, and must not touch the row. Written
      // back by hand rather than waited out: `now()` does not advance inside a
      // transaction, so a real five minutes could not be observed here anyway.
      await tx`update sessions set last_used_at = now() - interval '30 seconds' where user_id = ${user.id}`;
      const parked = await stampOf();

      expect(await repository.resolveSession(token)).toMatchObject({ id: user.id });
      expect(await stampOf()).toBe(parked);

      // Past the threshold it stamps again, so the column stays roughly true.
      await tx`update sessions set last_used_at = now() - interval '10 minutes' where user_id = ${user.id}`;
      expect(await repository.resolveSession(token)).toMatchObject({ id: user.id });
      expect(await stampOf()).not.toBe(parked);
      expect(await stampOf()).toBeGreaterThan((parked ?? 0) - 1);
    });
  });

  it("still refuses a revoked session on the very next request", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-revoke-now");
      const user = await repository.signInWithPhone(phone("35"), { inviteCode: code });
      const { token } = await repository.createSession(user.id);

      // The guarantee that makes this a database lookup rather than a JWT, and
      // the one the touch-throttling above must not have weakened: the read is
      // still unconditional, only the write is skipped.
      await repository.resolveSession(token);
      await tx`update sessions set last_used_at = now() where user_id = ${user.id}`;
      await repository.revokeSession(token);

      expect(await repository.resolveSession(token)).toBeNull();
    });
  });

  it("suspending an account ends its sessions", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "session-suspend");
      const user = await repository.signInWithPhone(phone("33"), { inviteCode: code });
      const { token } = await repository.createSession(user.id);

      await tx`update users set status = 'suspended' where id = ${user.id}`;
      expect(await repository.resolveSession(token)).toBeNull();
    });
  });
});

describe("abuse signals", () => {
  it("counts recent failures in a rolling window", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const identifier = "attacked@example.test";
      for (let i = 0; i < 3; i += 1) {
        await repository.recordLoginAttempt({ identifier, method: "password", succeeded: false, failureReason: "bad_password" });
      }
      await repository.recordLoginAttempt({ identifier, method: "password", succeeded: true });

      expect(await repository.recentLoginFailures(identifier)).toBe(3);
      expect(await repository.recentLoginFailures("someone-else@example.test")).toBe(0);
    });
  });

  it("records the device a signup came from", async () => {
    await inRollback(sql, async (tx) => {
      const repository = auth(tx);
      const code = await usableInvite(tx, "device-tracked");
      const user = await repository.signInWithPhone(phone("40"), {
        inviteCode: code,
        deviceFingerprint: "fp-abc",
        ip: "1.2.3.4",
      });

      const [row] = await tx<{ seen_at_signup: boolean }[]>`
        select seen_at_signup from device_fingerprints where user_id = ${user.id}
      `;
      // Feeds v_multi_account_devices, which is how trial farming shows up.
      expect(row?.seen_at_signup).toBe(true);
    });
  });
});
