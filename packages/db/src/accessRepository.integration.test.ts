import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresAccessRepository } from "./accessRepository";
import { COIN, connect, expectDbError, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

describe("invite codes", () => {
  it("reports who joined and what they spent", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const admin = await makeUser(tx);

      const invite = await access.createInvite({
        code: "apple-deev",
        label: "Apple campaign",
        createdBy: admin.userId,
        maxRedemptions: 500,
        grantCoins: 20,
        grantExpiresDays: 30,
      });
      expect(invite.code).toBe("apple-deev");
      expect(invite.grantCoins).toBe(20);
      expect(invite.isUsable).toBe(true);

      const joiner = await makeUser(tx);
      await access.redeemInvite("apple-deev", joiner.userId, joiner.accountId, "1.2.3.4");
      // Spend 7 of the 20 the campaign handed out.
      await tx`select capture_hold(hold_credits(${joiner.accountId}, ${7 * COIN}, 'job', uuid_generate_v7()))`;

      const after = await access.getInvite(invite.id);
      expect(after).toMatchObject({ usersJoined: 1, redemptionCount: 1, coinsSpent: 7, coinsRemaining: 13 });

      const redeemers = await access.listInviteRedeemers(invite.id);
      expect(redeemers).toHaveLength(1);
      expect(redeemers[0]).toMatchObject({ userId: joiner.userId, coinsSpent: 7 });
    });
  });

  it("matches a code however the invitee capitalised it", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      await access.createInvite({ code: "nowruz-1405", grantCoins: 5 });
      const joiner = await makeUser(tx);

      await expect(access.redeemInvite("NOWRUZ-1405", joiner.userId, joiner.accountId)).resolves.toBeTruthy();
    });
  });

  it("stops admitting people once the cap is reached", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const invite = await access.createInvite({ code: "two-seats", maxRedemptions: 2 });

      for (let i = 0; i < 2; i += 1) {
        const joiner = await makeUser(tx);
        await access.redeemInvite("two-seats", joiner.userId, joiner.accountId);
      }
      const third = await makeUser(tx);
      const error = await expectDbError(tx, () => access.redeemInvite("two-seats", third.userId, third.accountId));
      expect(error.message).toMatch(/invite_exhausted/);

      expect(await access.getInvite(invite.id)).toMatchObject({ redemptionCount: 2, isUsable: false });
    });
  });

  it("refuses a revoked code but keeps its history", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const admin = await makeUser(tx);
      const invite = await access.createInvite({ code: "short-lived", createdBy: admin.userId });
      const joiner = await makeUser(tx);
      await access.redeemInvite("short-lived", joiner.userId, joiner.accountId);

      const revoked = await access.revokeInvite(invite.id, admin.userId);
      expect(revoked).toMatchObject({ isUsable: false, usersJoined: 1 });
      expect(revoked?.revokedAt).toBeTypeOf("number");

      const late = await makeUser(tx);
      const error = await expectDbError(tx, () => access.redeemInvite("short-lived", late.userId, late.accountId));
      expect(error.message).toMatch(/invite_revoked/);
    });
  });

  it("deletes an unused code but never one that admitted somebody", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const unused = await access.createInvite({ code: "typo-code" });
      expect(await access.deleteInvite(unused.id)).toBe("deleted");
      expect(await access.getInvite(unused.id)).toBeNull();

      const used = await access.createInvite({ code: "real-code" });
      const joiner = await makeUser(tx);
      await access.redeemInvite("real-code", joiner.userId, joiner.accountId);

      // Deleting would orphan the record of who was let in — the campaign's
      // result and the trail for tracing abuse.
      expect(await access.deleteInvite(used.id)).toBe("has_redemptions");
      expect(await access.getInvite(used.id)).not.toBeNull();
    });
  });

  it("records a member invite as a pending referral", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const inviter = await makeUser(tx);
      await access.createInvite({ code: "friend-of-mine", kind: "user", ownerUserId: inviter.userId, grantCoins: 3 });

      const friend = await makeUser(tx);
      await access.redeemInvite("friend-of-mine", friend.userId, friend.accountId);

      const [referral] = await tx<{ status: string; referrer_user_id: string }[]>`
        select status, referrer_user_id from referrals where referred_user_id = ${friend.userId}
      `;
      // 'pending' until the friend actually pays — that is what stops farming.
      expect(referral).toMatchObject({ status: "pending", referrer_user_id: inviter.userId });
    });
  });

  it("will not let an inviter redeem their own code", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const inviter = await makeUser(tx);
      await access.createInvite({ code: "self-serve", kind: "user", ownerUserId: inviter.userId, grantCoins: 50 });

      const error = await expectDbError(tx, () => access.redeemInvite("self-serve", inviter.userId, inviter.accountId));
      expect(error.message).toMatch(/invite_self_redemption/);
    });
  });

  it("generates a batch of distinct codes", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const batch = await access.createInviteBatch(10, { maxRedemptions: 1, grantCoins: 5 });

      expect(batch).toHaveLength(10);
      expect(new Set(batch.map((invite) => invite.code)).size).toBe(10);
      expect(batch.every((invite) => invite.grantCoins === 5)).toBe(true);
    });
  });
});

describe("discount codes", () => {
  it("creates a flat-sum, first-purchase-only code", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const promo = await access.createPromo({
        code: "nowruz",
        label: "Nowruz 200k off",
        kind: "amount_off",
        amountOff: 200_000,
        firstPurchaseOnly: true,
        maxRedemptions: 1000,
      });

      expect(promo).toMatchObject({ code: "nowruz", kind: "amount_off", amountOff: 200_000, firstPurchaseOnly: true });
      expect(promo.isUsable).toBe(true);
    });
  });

  it("refuses a discount that names a kind it has no value for", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      await expectDbError(tx, () => access.createPromo({ code: "empty-percent", kind: "percent_off" }));
    });
  });

  it("revokes rather than deletes once redeemed", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const admin = await makeUser(tx);
      const promo = await access.createPromo({ code: "gone-soon", kind: "credits", coins: 10 });
      const customer = await makeUser(tx);
      await tx`
        insert into promo_redemptions (promo_code_id, account_id, user_id)
        values (${promo.id}, ${customer.accountId}, ${customer.userId})
      `;

      expect(await access.deletePromo(promo.id)).toBe("has_redemptions");
      const revoked = await access.revokePromo(promo.id, admin.userId);
      expect(revoked).toMatchObject({ isUsable: false, redemptions: 1, accounts: 1 });
    });
  });
});

describe("the early access gate", () => {
  it("starts closed and can be opened in one call", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const admin = await makeUser(tx);

      expect(await access.isEarlyAccess()).toBe(true);
      expect(await access.setEarlyAccess(false, admin.userId)).toBe(false);
      expect(await access.isEarlyAccess()).toBe(false);
      expect(await access.setEarlyAccess(true, admin.userId)).toBe(true);
    });
  });

  it("fails closed if the flag row is missing", async () => {
    await inRollback(sql, async (tx) => {
      // A gate that disappears silently is an open signup page.
      await tx`delete from feature_flags where code = 'early_access'`;
      expect(await new PostgresAccessRepository(tx).isEarlyAccess()).toBe(true);
    });
  });
});
