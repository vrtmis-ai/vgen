import type { CheckoutCycle, PaidOrder } from "@vgen/contracts";
import { ANNUAL_MONTHS, MICRO_CREDITS_PER_COIN } from "@vgen/core";
import type { Sql } from "postgres";

export interface CreateOrderInput {
  userId: string;
  planCode: string;
  cycle: CheckoutCycle;
}

export type CreateOrderOutcome =
  | { outcome: "ordered"; order: { orderId: string; amountToman: number } }
  | { outcome: "unknown_plan" }
  | { outcome: "no_annual_option" }
  | { outcome: "no_exchange_rate" }
  | { outcome: "no_account" };

export interface CheckoutRepository {
  createOrder(input: CreateOrderInput): Promise<CreateOrderOutcome>;
  listOrders(userId: string, limit?: number): Promise<PaidOrder[]>;
}

interface OrderRow {
  id: string;
  created_at: Date;
  status: string;
  amount: string;
  currency: string;
  micro_credits: string;
  plan_code: string | null;
}

interface PlanRow {
  id: string;
  price_amount: string;
  annual_price_amount: string | null;
  micro_credits_per_term: string;
}

interface RateRow {
  id: string;
  rate: string;
}

/**
 * Toman, from a USD amount and the day's rate.
 *
 * Rounded to the nearest thousand Toman because that is how a price is written
 * here and, more to the point, because it is what the checkout sheet already
 * does to the figure it displays. The sheet compares the two and refuses to
 * send anyone to a gateway when they differ, so a rounding rule that disagreed
 * by a single Toman would block every purchase rather than overcharge — safe,
 * and completely broken.
 *
 * The rate is Rial per dollar, which is the unit `fx_rates` stores and the unit
 * `orders.amount` is in. Toman is Rial/10 and is display only; nothing is ever
 * persisted in it.
 */
export function tomanFor(usd: number, rialPerUsd: number): number {
  return Math.round((usd * rialPerUsd) / 10 / 1000) * 1000;
}

export class PostgresCheckoutRepository implements CheckoutRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Price a plan, record the order, and say where to send the person.
   *
   * The browser sends a plan and a cadence and no amount at all, so there is
   * exactly one calculation of what this costs and it happens here. What is
   * stored is what was charged AND what a dollar was worth when it was charged
   * — `orders` carries `amount_usd` and `fx_rate_id` for precisely that reason,
   * because otherwise every margin figure silently rewrites itself the next
   * time the rate moves.
   */
  async createOrder({ userId, planCode, cycle }: CreateOrderInput): Promise<CreateOrderOutcome> {
    const [plan] = await this.sql<PlanRow[]>`
      select id, price_amount, annual_price_amount, micro_credits_per_term
      from plans
      where code = ${planCode} and is_active and is_public
      limit 1
    `;
    // A plan that is retired, private or misspelled is one answer. Telling the
    // three apart would say which private plan codes exist.
    if (!plan) return { outcome: "unknown_plan" };

    if (cycle === "annual" && plan.annual_price_amount === null) {
      // Refused rather than quietly billed monthly. The browser already resolves
      // the cadence before it asks, so reaching this means the two halves
      // disagree about what is on sale — and charging a different cadence than
      // the one requested is the worst available way to resolve that.
      return { outcome: "no_annual_option" };
    }

    const monthlyUsd = Number(cycle === "annual" ? plan.annual_price_amount : plan.price_amount);
    const usd = cycle === "annual" ? monthlyUsd * ANNUAL_MONTHS : monthlyUsd;

    const [rate] = await this.sql<RateRow[]>`
      select id, rate
      from fx_rates
      where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
      order by valid_from desc
      limit 1
    `;
    // No rate means no honest price. Quoting one from a constant compiled into
    // the server is how the figure on the screen and the figure in the books
    // start to disagree.
    if (!rate) return { outcome: "no_exchange_rate" };

    const amountToman = tomanFor(usd, Number(rate.rate));
    // ponytail: orders.amount is numeric(12,2), so this tops out around 10bn
    // Rial — about $588k on one order. Raise the column, not this line, if a
    // plan ever costs that.
    const amountRial = amountToman * 10;

    /* The grant is one term's coins whatever the cadence, because annual buys
       twelve payments made at once and not twelve months of coins handed over
       on day one — see the comment on plans.annual_price_amount. Recording the
       full year here would put a year of credit in one lot and make it expire
       in thirty days.

       The account comes from the same statement rather than a lookup before it,
       so a user row without a personal account is an outcome instead of a
       foreign-key violation surfacing as a 500. */
    const [order] = await this.sql<{ id: string }[]>`
      insert into orders (account_id, user_id, plan_id, micro_credits, amount, currency, amount_usd, fx_rate_id)
      select u.personal_account_id, u.id, ${plan.id}, ${plan.micro_credits_per_term},
             ${amountRial}, 'IRR', ${usd}, ${rate.id}
      from users u
      where u.id = ${userId} and u.personal_account_id is not null and u.deleted_at is null
      returning id
    `;
    if (!order) return { outcome: "no_account" };

    return { outcome: "ordered", order: { orderId: order.id, amountToman } };
  }

  /**
   * What this person has bought, newest first.
   *
   * Keyed on the user rather than the account: "my purchases" is the question
   * the account page asks, and on a team account somebody else's order is not
   * an answer to it.
   *
   * Rial back to Toman, because the column stores what a gateway would be told
   * and the customer was quoted the other one — the same factor `createOrder`
   * applies in the opposite direction. Guarded on the currency rather than
   * applied blindly, so an order recorded in anything else is passed through at
   * its own figure instead of being quietly divided by ten.
   *
   * Every order, not only the paid ones: somebody whose payment failed is
   * exactly who goes looking for this list, and so is whoever supports them.
   */
  async listOrders(userId: string, limit = 50): Promise<PaidOrder[]> {
    const rows = await this.sql<OrderRow[]>`
      select o.id::text as id,
             o.created_at,
             o.status,
             o.amount::text as amount,
             o.currency,
             o.micro_credits::text as micro_credits,
             p.code as plan_code
      from orders o
      left join plans p on p.id = o.plan_id
      where o.user_id = ${userId}
      -- created_at defaults to now(), which is the TRANSACTION's clock: two
      -- orders written together carry the same instant and the sort between
      -- them is undefined. The id breaks the tie and is not arbitrary - it is
      -- uuid v7, so it sorts by the moment the row was made, finer than the
      -- column does.
      order by o.created_at desc, o.id desc
      limit ${limit}
    `;

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.getTime(),
      status: row.status as PaidOrder["status"],
      amountToman: row.currency === "IRR" ? Number(row.amount) / 10 : Number(row.amount),
      coins: Number(row.micro_credits) / MICRO_CREDITS_PER_COIN,
      ...(row.plan_code === null ? {} : { planCode: row.plan_code }),
    }));
  }
}
