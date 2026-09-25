import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InviteLimitError, PostgresAccessRepository } from "./accessRepository";
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

describe("editing an invite code's limits", () => {
  it("shows the expiry and moves it and the cap when asked", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const expiresAt = new Date(Date.now() + 7 * 86_400_000);
      const invite = await access.createInvite({ code: "edit-me", maxRedemptions: 3, expiresAt });
      expect(invite.expiresAt).toBe(expiresAt.getTime());

      const later = new Date(Date.now() + 30 * 86_400_000);
      const edited = await access.updateInvite(invite.id, { maxRedemptions: 10, expiresAt: later });

      expect(edited).toMatchObject({ maxRedemptions: 10, expiresAt: later.getTime(), isUsable: true });
    });
  });

  it("closes a code at once when its expiry is moved into the past", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const invite = await access.createInvite({ code: "close-now", maxRedemptions: 3, expiresAt: new Date(Date.now() + 86_400_000) });

      const closed = await access.updateInvite(invite.id, { expiresAt: new Date(Date.now() - 1000) });

      expect(closed?.isUsable).toBe(false);
      const joiner = await makeUser(tx);
      const error = await expectDbError(tx, () => access.redeemInvite("close-now", joiner.userId, joiner.accountId));
      expect(error.message).toMatch(/invite_expired/);
    });
  });

  it("will not set the cap below the people already admitted, and leaves the code untouched", async () => {
    await inRollback(sql, async (tx) => {
      const access = new PostgresAccessRepository(tx);
      const invite = await access.createInvite({ code: "cap-floor", maxRedemptions: 5, expiresAt: new Date(Date.now() + 86_400_000) });
      for (let i = 0; i < 2; i += 1) {
        const joiner = await makeUser(tx);
        await access.redeemInvite("cap-floor", joiner.userId, joiner.accountId);
      }

      await expect(access.updateInvite(invite.id, { maxRedemptions: 1 })).rejects.toBeInstanceOf(InviteLimitError);
      expect(await access.getInvite(invite.id)).toMatchObject({ maxRedemptions: 5, redemptionCount: 2 });

      // Exactly the number used is allowed: that is how a code is closed without revoking it.
      expect(await access.updateInvite(invite.id, { maxRedemptions: 2 })).toMatchObject({ maxRedemptions: 2, isUsable: false });
    });
  });

  it("answers null for a code that does not exist", async () => {
    await inRollback(sql, async (tx) => {
      expect(await new PostgresAccessRepository(tx).updateInvite("00000000-0000-7000-8000-000000000000", { maxRedemptions: 2 })).toBeNull();
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

/**
 * The queue for people the gate turns away.
 *
 * Two claims carry the weight, and both are about fairness rather than shape:
 * one person holds one place, and asking again neither gains nor loses it.
 */
describe("the waitlist", () => {
  it("keeps one place per person however many times they ask", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);

      await access.joinWaitlist("email", "twice@example.com");
      await access.joinWaitlist("email", "twice@example.com");
      // citext: the column cannot be talked into a second place by the shift key.
      await access.joinWaitlist("email", "TWICE@EXAMPLE.COM");

      expect(await access.waitlistCount()).toBe(1);
    });
  });

  it("does not move somebody down the queue for asking again", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);

      await access.joinWaitlist("email", "first@example.com");
      await access.joinWaitlist("email", "second@example.com");
      await access.joinWaitlist("email", "first@example.com");

      // `on conflict do nothing` rather than an upsert, so the second ask is
      // not a new row and created_at is untouched. An upsert here would let
      // anybody jump the queue by submitting twice — or lose their place.
      expect((await access.listWaitlist()).map((entry) => entry.contact)).toEqual(["first@example.com", "second@example.com"]);
    });
  });

  /* These run inside one rolled-back transaction, where `now()` is frozen at
     the transaction's start — so every row would carry the same `created_at`
     and the order would fall to the random low bits of a uuid v7. That is why
     the column defaults to `clock_timestamp()`: arrival order is the queue's
     only rule, and a rule decided by a coin flip is not one. */
  it("reads oldest first, which is the order it will be invited in", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);
      for (const contact of ["a@example.com", "b@example.com", "c@example.com"]) await access.joinWaitlist("email", contact);

      const queue = await access.listWaitlist();

      expect(queue.map((entry) => entry.contact)).toEqual(["a@example.com", "b@example.com", "c@example.com"]);
      expect(queue.every((entry) => entry.invitedAt === null && !entry.joined)).toBe(true);
    });
  });

  it("carries the channel, so a number is kept even though only mail can be sent", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);

      await access.joinWaitlist("email", "reachable@example.com");
      await access.joinWaitlist("phone", "09121234567");

      expect((await access.listWaitlist()).map((entry) => entry.channel)).toEqual(["email", "phone"]);
    });
  });

  /* The selection the invite button runs on. Everything here is about who is
     skipped, because a place quietly absorbed by somebody unreachable is a
     place nobody notices was lost. */
  it("offers only people who can actually be sent something", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);
      await access.joinWaitlist("email", "reachable@example.com");
      await access.joinWaitlist("phone", "09121234567");

      // A number is kept on the list and shown in the panel, but invites go by
      // mail — so it must not take a place in a batch that cannot reach it.
      expect((await access.nextWaitlistToInvite(10)).map((row) => row.contact)).toEqual(["reachable@example.com"]);
    });
  });

  it("walks down the queue instead of re-inviting the top of it", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);
      const invite = await access.createInvite({ maxRedemptions: 1 });
      for (const contact of ["a@example.com", "b@example.com", "c@example.com"]) await access.joinWaitlist("email", contact);

      const first = await access.nextWaitlistToInvite(1);
      await access.markWaitlistInvited(first[0]!.id, invite.id);
      const second = await access.nextWaitlistToInvite(1);

      expect(first.map((row) => row.contact)).toEqual(["a@example.com"]);
      expect(second.map((row) => row.contact)).toEqual(["b@example.com"]);
    });
  });

  it("records which code somebody was sent, and will not overwrite it", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);
      const first = await access.createInvite({ maxRedemptions: 1 });
      const second = await access.createInvite({ maxRedemptions: 1 });
      await access.joinWaitlist("email", "once@example.com");
      const [entry] = await access.nextWaitlistToInvite(1);

      await access.markWaitlistInvited(entry!.id, first.id);
      // `where invited_at is null` in the update, so a retry that raced a
      // successful send cannot rewrite history and strand the first code.
      await access.markWaitlistInvited(entry!.id, second.id);

      const [row] = await tx`select invite_code_id from waitlist_entries where id = ${entry!.id}`;
      expect(row!.invite_code_id).toBe(first.id);
      expect(await access.nextWaitlistToInvite(10)).toEqual([]);
    });
  });

  it("separates waiting from invited from arrived", async () => {
    await inRollback(sql, async (tx) => {
      // Ambient rows would make every count and order below depend on
      // whatever the last person to touch this database left behind.
      // Rolled back with the rest of the transaction.
      await tx`delete from waitlist_entries`;
      const access = new PostgresAccessRepository(tx);
      const invited = await makeUser(tx);
      await access.joinWaitlist("email", "waiting@example.com");
      await access.joinWaitlist("email", "asked@example.com");
      await access.joinWaitlist("email", "arrived@example.com");

      // Written by hand here because nothing sends invites yet; this asserts
      // the read can already tell the three states apart when it does.
      await tx`update waitlist_entries set invited_at = now() where contact = 'asked@example.com'`;
      await tx`update waitlist_entries set invited_at = now(), user_id = ${invited.userId} where contact = 'arrived@example.com'`;

      const byContact = new Map((await access.listWaitlist()).map((entry) => [entry.contact, entry]));
      expect(byContact.get("waiting@example.com")).toMatchObject({ invitedAt: null, joined: false });
      expect(byContact.get("asked@example.com")).toMatchObject({ joined: false });
      expect(byContact.get("asked@example.com")!.invitedAt).not.toBeNull();
      expect(byContact.get("arrived@example.com")).toMatchObject({ joined: true });
    });
  });
});
