import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresWalletRepository } from "./walletRepository";
import { COIN, connect, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});

afterAll(async () => {
  await sql.end();
});

describe("Postgres wallet repository", () => {
  it("projects only spendable lots and reports the next expiry", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);

      // Soonest-expiring first, which is also the order credits are spent in.
      const [expiring] = await tx<{ id: string }[]>`
        insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
        values (${accountId}, 'signup_bonus', ${12 * COIN}, ${10 * COIN}, now() + interval '2 days')
        returning id
      `;
      await tx`
        insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
        values
          (${accountId}, 'promo',       ${8 * COIN}, ${5 * COIN}, null),
          (${accountId}, 'purchase',    ${7 * COIN}, ${7 * COIN}, now() - interval '1 minute'),
          (${accountId}, 'admin_grant', ${4 * COIN}, 0,           now() + interval '3 days')
      `;

      const wallet = await new PostgresWalletRepository(tx).getCurrent(userId);

      // 10 + 5. The expired lot and the emptied lot are both invisible.
      expect(wallet.spendable).toBe(15);
      expect(wallet.grants).toHaveLength(2);
      expect(wallet.grants[0]).toMatchObject({ id: expiring!.id, kind: "signup_gift", coinsGranted: 12, coinsRemaining: 10 });
      expect(wallet.grants[0]!.expiresAt).toBeTypeOf("number");
      expect(wallet.grants[1]).toMatchObject({ kind: "reward", coinsGranted: 8, coinsRemaining: 5 });
      expect(wallet.grants[1]).not.toHaveProperty("expiresAt");
      expect(wallet.nextExpiry).toEqual({ at: wallet.grants[0]!.expiresAt, coins: 10 });
    });
  });

  it("never reports more coins than the balance can actually buy", async () => {
    await inRollback(sql, async (tx) => {
      const { userId, accountId } = await makeUser(tx);
      // Three lots that are each half a coin short of a whole one. Converting
      // per lot and adding would report 0; the total is genuinely 1 coin.
      await tx`
        insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
        values
          (${accountId}, 'promo', 500000, 500000, null),
          (${accountId}, 'promo', 500000, 500000, null),
          (${accountId}, 'promo', 500000, 500000, null)
      `;

      const wallet = await new PostgresWalletRepository(tx).getCurrent(userId);

      expect(wallet.spendable).toBe(1);
    });
  });

  it("reads only the asking user's own credit", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await tx`
        insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining)
        values (${theirs.accountId}, 'purchase', ${99 * COIN}, ${99 * COIN})
      `;

      const wallet = await new PostgresWalletRepository(tx).getCurrent(mine.userId);

      expect(wallet.spendable).toBe(0);
      expect(wallet.grants).toEqual([]);
    });
  });
});
