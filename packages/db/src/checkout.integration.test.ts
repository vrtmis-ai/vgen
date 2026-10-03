import type { Plan } from "@vgen/contracts";
import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCampaignsRepository } from "./campaignsRepository";
import { PostgresCheckoutRepository, tomanFor } from "./checkoutRepository";
import { PostgresPlansRepository } from "./plansRepository";
import { connect, expectDbError, inRollback, makeUser, COIN } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

/**
 * The two routes the plans screen was built against and the server did not
 * answer: the campaign window it counts down to, and the order its buy button
 * registers.
 *
 * What these tests are really about is that neither one can quote a number the
 * other will not honour. The strip's headline comes out of the same plan rows
 * checkout prices from, and the amount the browser is told is the amount the
 * order was written with.
 */

/** A plan of our own, so the assertions do not move when the real ladder is repriced. */
async function makePlan(
  tx: Sql,
  options: { code: string; monthlyUsd: number; annualUsdPerMonth?: number | null; coins?: number; bonusCoins?: number },
): Promise<string> {
  const coins = options.coins ?? 100;
  const bonusCoins = options.bonusCoins ?? 0;
  const [plan] = await tx<{ id: string }[]>`
    insert into plans (code, name, tier, micro_credits_per_term, price_amount, annual_price_amount, is_public, is_active, presentation)
    values (
      ${options.code}, ${`Test ${options.code}`}, 1, ${coins * COIN},
      ${options.monthlyUsd}, ${options.annualUsdPerMonth ?? null}, true, true,
      ${tx.json({ baseCoins: coins - bonusCoins, bonusCoins })}
    )
    returning id
  `;
  return plan!.id;
}

/** Days from now, as an interval the database evaluates against its own clock. */
const days = (tx: Sql, count: number) => tx`now() + ${count} * interval '1 day'`;

async function runCampaign(tx: Sql, options: { code?: string; startsInDays?: number; endsInDays: number }) {
  await tx`
    insert into campaigns (code, name, starts_at, ends_at)
    values (
      ${options.code ?? "nowruz-1405"}, 'Test campaign',
      ${days(tx, options.startsInDays ?? 0)}, ${days(tx, options.endsInDays)}
    )
  `;
}

/** Structural, so the fold can be checked against a ladder chosen for the test. */
const ladder = (plans: Partial<Plan>[]) => ({ list: async () => ({ plans: plans as Plan[] }) });

describe("the campaign window", () => {
  it("says there is nothing running, which is most of the year", async () => {
    await inRollback(sql, async (tx) => {
      const campaigns = new PostgresCampaignsRepository(tx, ladder([]));

      expect(await campaigns.getActive()).toBeNull();
    });
  });

  it("reports the end as an absolute instant the browser can count down to", async () => {
    await inRollback(sql, async (tx) => {
      await runCampaign(tx, { endsInDays: 4 });
      const campaigns = new PostgresCampaignsRepository(tx, ladder([]));

      const active = await campaigns.getActive();

      expect(active?.id).toBe("nowruz-1405");
      // Within a minute of four days out, not "four days" — a duration is what
      // the strip used to get, and it restarted on every reload.
      const fourDaysOut = Date.now() + 4 * 24 * 60 * 60 * 1000;
      expect(Math.abs((active?.endsAt ?? 0) - fourDaysOut)).toBeLessThan(60_000);
    });
  });

  it("keeps quiet about a campaign that has not started and one that has ended", async () => {
    await inRollback(sql, async (tx) => {
      const campaigns = new PostgresCampaignsRepository(tx, ladder([]));

      await runCampaign(tx, { code: "later", startsInDays: 3, endsInDays: 9 });
      expect(await campaigns.getActive()).toBeNull();

      await tx`delete from campaigns`;
      await runCampaign(tx, { code: "over", startsInDays: -9, endsInDays: -1 });
      expect(await campaigns.getActive()).toBeNull();
    });
  });

  /**
   * The strip has room for one offer. Two overlapping windows would mean it
   * showed whichever the planner happened to return first, so the second INSERT
   * fails at the moment somebody makes the mistake instead of at the moment a
   * customer reads the wrong discount.
   */
  it("will not let two campaigns run at once", async () => {
    await inRollback(sql, async (tx) => {
      await runCampaign(tx, { code: "first", endsInDays: 10 });

      const error = await expectDbError(tx, () => runCampaign(tx, { code: "second", startsInDays: 2, endsInDays: 20 }));

      expect(error.message).toMatch(/exclusion constraint/i);
    });
  });

  it("refuses a window that ends before it starts", async () => {
    await inRollback(sql, async (tx) => {
      const error = await expectDbError(tx, () => runCampaign(tx, { code: "backwards", startsInDays: 5, endsInDays: 1 }));

      expect(error.message).toMatch(/campaigns_window_check/);
    });
  });

  /**
   * The substance of the whole design. The strip prints "up to N% off annual"
   * under the words "limited time", so N has to be what checkout will charge.
   * Stored on the campaign row it would be a number somebody typed; folded out
   * of the ladder it is the same rows the order is priced from.
   */
  it("takes its headline from the plan ladder, not from the campaign row", async () => {
    await inRollback(sql, async (tx) => {
      await runCampaign(tx, { endsInDays: 2 });
      const campaigns = new PostgresCampaignsRepository(
        tx,
        ladder([
          { monthlyUsd: 49, annualUsdPerMonth: 39, bonusCoins: 100 }, // 20%
          { monthlyUsd: 139, annualUsdPerMonth: 109, bonusCoins: 350 }, // 21.58% -> 22
          { monthlyUsd: 4, annualUsdPerMonth: null, bonusCoins: 0 }, // no annual option
        ]),
      );

      const active = await campaigns.getActive();

      expect(active?.maxDiscountPct).toBe(22);
      expect(active?.maxBonusCoins).toBe(350);
    });
  });

  it("advertises nothing when no plan discounts or gives anything", async () => {
    await inRollback(sql, async (tx) => {
      await runCampaign(tx, { endsInDays: 2 });
      const campaigns = new PostgresCampaignsRepository(tx, ladder([{ monthlyUsd: 4, annualUsdPerMonth: null, bonusCoins: 0 }]));

      const active = await campaigns.getActive();

      expect(active?.maxDiscountPct).toBe(0);
      expect(active?.maxBonusCoins).toBe(0);
    });
  });

  it("reads the ladder the plans route serves, so the two cannot disagree", async () => {
    await inRollback(sql, async (tx) => {
      await runCampaign(tx, { endsInDays: 2 });
      // The seeded ladder used to discount and give bonus coins by itself, which
      // is what told a real read from the fold of an empty list. Since the
      // competitor repricing it does neither — no plan is sold for a year and
      // none carries a bonus — so the canary is planted here instead of being
      // borrowed from the price list, which is free to change again.
      await makePlan(tx, { code: "test-campaign-ladder", monthlyUsd: 50, annualUsdPerMonth: 40, coins: 600, bonusCoins: 100 });
      const plans = new PostgresPlansRepository(tx);
      const campaigns = new PostgresCampaignsRepository(tx, plans);

      const active = await campaigns.getActive();
      const { plans: served } = await plans.list();

      expect(active?.maxBonusCoins).toBe(Math.max(...served.map((plan) => plan.bonusCoins)));
      // Still not the fold of an empty list: the plan above discounts 20% and
      // gives 100 coins, and only a repository that really reads the ladder
      // reports either of them.
      expect(active?.maxDiscountPct).toBeGreaterThan(0);
      expect(active?.maxBonusCoins).toBeGreaterThan(0);
    });
  });
});

const orderFor = (tx: Sql, orderId: string) =>
  tx<{ amount: string; currency: string; amount_usd: string; fx_rate_id: string; micro_credits: string; status: string }[]>`
    select amount, currency, amount_usd, fx_rate_id, micro_credits, status from orders where id = ${orderId}
  `;

describe("registering an order", () => {
  it("prices a month from the plan row and records what a dollar was worth", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-monthly", monthlyUsd: 49 });
      const checkout = new PostgresCheckoutRepository(tx);

      const result = await checkout.createOrder({ userId, planCode: "test-monthly", cycle: "monthly" });

      expect(result.outcome).toBe("ordered");
      if (result.outcome !== "ordered") return;
      // $49 at 1,700,000 Rial to the dollar. The same arithmetic the checkout
      // sheet does to the figure it displays, which is why it matches.
      expect(result.order.amountToman).toBe(8_330_000);

      const [row] = await orderFor(tx, result.order.orderId);
      expect(row?.status).toBe("pending");
      expect(row?.currency).toBe("IRR");
      expect(Number(row?.amount)).toBe(83_300_000);
      expect(Number(row?.amount_usd)).toBe(49);
      // Without this the margin on every past order silently rewrites itself
      // the next time the rate moves.
      expect(row?.fx_rate_id).toBeTruthy();
    });
  });

  /* The read half, added in #143. Deliberately rate-independent: it asserts the
     figure comes back as the figure `createOrder` quoted, whatever the day's
     exchange rate was, which is the round trip that matters — the column holds
     Rial and the customer was quoted Toman. */
  it("reads an order back as the amount the customer was quoted", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-history", monthlyUsd: 49, coins: 500 });
      const checkout = new PostgresCheckoutRepository(tx);

      const created = await checkout.createOrder({ userId, planCode: "test-history", cycle: "monthly" });
      expect(created.outcome).toBe("ordered");
      if (created.outcome !== "ordered") return;

      const [order, ...rest] = await checkout.listOrders(userId);

      expect(rest).toHaveLength(0);
      expect(order).toMatchObject({
        id: created.order.orderId,
        status: "pending",
        // Toman, not the Rial in the column: ten times out and ten times back.
        amountToman: created.order.amountToman,
        coins: 500,
        planCode: "test-history",
      });
      expect(order?.createdAt).toBeGreaterThan(0);
    });
  });

  it("shows one person their own orders and nobody else's, newest first", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await makePlan(tx, { code: "test-first", monthlyUsd: 19, coins: 100 });
      await makePlan(tx, { code: "test-second", monthlyUsd: 49, coins: 500 });
      const checkout = new PostgresCheckoutRepository(tx);

      const first = await checkout.createOrder({ userId: mine.userId, planCode: "test-first", cycle: "monthly" });
      const second = await checkout.createOrder({ userId: mine.userId, planCode: "test-second", cycle: "monthly" });
      await checkout.createOrder({ userId: theirs.userId, planCode: "test-first", cycle: "monthly" });
      expect([first.outcome, second.outcome]).toEqual(["ordered", "ordered"]);
      if (first.outcome !== "ordered" || second.outcome !== "ordered") return;

      // `created_at` defaults to `now()`, which is the transaction's start time
      // and so identical for all three of these. The repository breaks that tie
      // on `id desc`, and `uuid_generate_v7` fills everything below the
      // millisecond from `gen_random_uuid()` — random, not a counter. With
      // nothing real to sort by, "newest first" came out either way and this
      // test failed about half the time. Age the first order so the clock
      // decides.
      await tx`update orders set created_at = now() - interval '1 second' where id = ${first.order.orderId}`;

      const orders = await checkout.listOrders(mine.userId);

      // Two, not three: the third belongs to somebody else.
      expect(orders.map((order) => order.planCode)).toEqual(["test-second", "test-first"]);
      expect(await checkout.listOrders(theirs.userId)).toHaveLength(1);
    });
  });

  it("charges twelve months at the annual rate when a year is paid at once", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-annual", monthlyUsd: 139, annualUsdPerMonth: 109, coins: 3350 });
      const checkout = new PostgresCheckoutRepository(tx);

      const result = await checkout.createOrder({ userId, planCode: "test-annual", cycle: "annual" });

      expect(result.outcome).toBe("ordered");
      if (result.outcome !== "ordered") return;
      expect(result.order.amountToman).toBe(tomanFor(109 * 12, 1_700_000));

      const [row] = await orderFor(tx, result.order.orderId);
      expect(Number(row?.amount_usd)).toBe(1308);
      // One term's coins, not twelve. Annual buys twelve payments made at once
      // and not a year of credit handed over on day one — a year in one lot
      // would expire in thirty days.
      expect(row?.micro_credits).toBe(String(3350 * COIN));
    });
  });

  it("refuses a year on a plan that is not sold by the year", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-entry", monthlyUsd: 4 });
      const checkout = new PostgresCheckoutRepository(tx);

      // Quietly billing a month would charge a different cadence than the one
      // that was asked for, which is the worst way to resolve the disagreement.
      expect(await checkout.createOrder({ userId, planCode: "test-entry", cycle: "annual" })).toEqual({
        outcome: "no_annual_option",
      });
      expect(await tx`select 1 from orders where user_id = ${userId}`).toHaveLength(0);
    });
  });

  it("gives one answer for a plan that is retired, private or misspelled", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-hidden", monthlyUsd: 9 });
      await tx`update plans set is_public = false where code = 'test-hidden'`;
      const checkout = new PostgresCheckoutRepository(tx);

      // Telling the three apart would say which private plan codes exist.
      expect(await checkout.createOrder({ userId, planCode: "test-hidden", cycle: "monthly" })).toEqual({ outcome: "unknown_plan" });
      expect(await checkout.createOrder({ userId, planCode: "no-such-plan", cycle: "monthly" })).toEqual({ outcome: "unknown_plan" });
    });
  });

  it("writes the order against the buyer's own account", async () => {
    await inRollback(sql, async (tx) => {
      const mine = await makeUser(tx);
      const theirs = await makeUser(tx);
      await makePlan(tx, { code: "test-account", monthlyUsd: 25 });
      const checkout = new PostgresCheckoutRepository(tx);

      const result = await checkout.createOrder({ userId: mine.userId, planCode: "test-account", cycle: "monthly" });

      expect(result.outcome).toBe("ordered");
      const [row] = await tx<{ account_id: string }[]>`select account_id from orders where user_id = ${mine.userId}`;
      expect(row?.account_id).toBe(mine.accountId);
      expect(row?.account_id).not.toBe(theirs.accountId);
    });
  });

  /**
   * A signed-in user whose row carries no personal account is a broken signup,
   * not a bad request. It comes back as an outcome so the route can answer 503
   * rather than letting a foreign-key violation surface as a 500.
   */
  it("reports a user with no account instead of failing on the foreign key", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await tx`update users set personal_account_id = null where id = ${userId}`;
      await makePlan(tx, { code: "test-orphan", monthlyUsd: 25 });

      expect(await new PostgresCheckoutRepository(tx).createOrder({ userId, planCode: "test-orphan", cycle: "monthly" })).toEqual({
        outcome: "no_account",
      });
    });
  });

  it("will not invent a price when no exchange rate is published", async () => {
    await inRollback(sql, async (tx) => {
      const { userId } = await makeUser(tx);
      await makePlan(tx, { code: "test-norate", monthlyUsd: 25 });
      await tx`update fx_rates set valid_to = now() where valid_to is null`;

      // Falling back to a constant compiled into the server is how the figure
      // on the screen and the figure in the books start to disagree.
      expect(await new PostgresCheckoutRepository(tx).createOrder({ userId, planCode: "test-norate", cycle: "monthly" })).toEqual({
        outcome: "no_exchange_rate",
      });
    });
  });
});
