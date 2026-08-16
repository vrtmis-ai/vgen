/**
 * Seed the plan ladder into Postgres.
 *
 * `src/data/plans.rows.json` is the ladder. It was generated once from the
 * `PLANS` array that used to be the only copy, and it is what both this seeder
 * and the Plans screen read — so a plan cannot exist on the card and not in the
 * table, which is how a customer buys something the ledger has never heard of.
 *
 * Idempotent by content, like the catalogue: `plans` has an updated_at trigger
 * and rows are referenced by orders and subscriptions, so an unconditional
 * upsert would touch every row on every deploy for nothing.
 *
 * Run: pnpm plans:publish   (needs DATABASE_URL)
 */
import { config } from "dotenv";
import postgres from "postgres";
import { MICRO_CREDITS_PER_COIN } from "@vgen/core";
import { TOMAN_PER_USD } from "../src/data/plans";
import planList from "../src/data/plans.rows.json" with { type: "json" };

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish plans");

interface PlanRow {
  code: string;
  name: string;
  tier: 1 | 2 | 3;
  baseCoins: number;
  bonusCoins: number;
  monthlyUsd: number;
  annualUsdPerMonth: number | null;
  group: "entry" | "main";
  tag: string | null;
  popular: boolean;
  sortOrder: number;
  maxConcurrentJobs: number;
}

const rows = (planList as { rows: PlanRow[] }).rows;

/**
 * Every plan grants monthly, including the annual ones.
 *
 * Annual is a payment cadence, not a longer grant: twelve months are paid up
 * front but the coins still arrive monthly and still expire after thirty days,
 * which is exactly where the annual margin comes from. A 365-day term would
 * hand someone a year of coins on day one.
 */
const TERM_DAYS = 30;

/**
 * Prices are stored in USD.
 *
 * The coin economy pivots on USD — a coin is $0.05 — so the Toman figure a
 * customer sees is a conversion applied at the edge, and a rate change moves
 * one number rather than every plan row.
 */
const CURRENCY = "USD";

/**
 * No plan caps resolution, length or concurrency today.
 *
 * The columns exist and mean something, so they are set to values that say "not
 * capped" rather than left at a schema default of 720px — which would be a
 * limit nobody decided, sitting in the table waiting for the first thing that
 * reads it to enforce it.
 */
const UNCAPPED_RESOLUTION_PX = 4320;

/**
 * The Toman figure a customer sees, as a rate rather than as a second price.
 *
 * Prices are stored in USD, so every Rial a customer is ever shown is this one
 * number applied at the edge — which is why it belongs in a table and not only
 * in a constant compiled into the browser. `quotes.exchange_rate_irr_per_usd`
 * is NOT NULL precisely so a quote can always say what rate it was shown at,
 * and a quote cannot be written at all until this row exists.
 *
 * Rials, not Toman: the column says IRR and the two differ by a factor of ten.
 * Getting this backwards would under-charge by 90%, so the conversion is done
 * here, once, next to the constant it converts.
 */
const IRR_PER_TOMAN = 10;
const IRR_PER_USD = TOMAN_PER_USD * IRR_PER_TOMAN;

const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    let written = 0;

    for (const row of rows) {
      const microCredits = (row.baseCoins + row.bonusCoins) * MICRO_CREDITS_PER_COIN;
      const presentation = {
        group: row.group,
        popular: row.popular,
        // Kept because the card shows the split — "500 + 25 bonus" — while the
        // grant is the total. The bonus is the volume discount made visible.
        baseCoins: row.baseCoins,
        bonusCoins: row.bonusCoins,
        ...(row.tag ? { tag: row.tag } : {}),
      };

      const [changed] = await tx<{ id: string }[]>`
        insert into plans (
          code, name, tier, micro_credits_per_term, term_days,
          price_amount, currency, annual_price_amount,
          max_resolution_px, max_concurrent_jobs, presentation, sort_order, is_public, is_active
        ) values (
          ${row.code}, ${row.name}, ${row.tier}, ${microCredits}, ${TERM_DAYS},
          ${row.monthlyUsd}, ${CURRENCY}, ${row.annualUsdPerMonth},
          ${UNCAPPED_RESOLUTION_PX}, ${row.maxConcurrentJobs}, ${tx.json(presentation)}, ${row.sortOrder}, true, true
        )
        on conflict (code) do update set
          name = excluded.name,
          tier = excluded.tier,
          micro_credits_per_term = excluded.micro_credits_per_term,
          term_days = excluded.term_days,
          price_amount = excluded.price_amount,
          currency = excluded.currency,
          annual_price_amount = excluded.annual_price_amount,
          max_resolution_px = excluded.max_resolution_px,
          max_concurrent_jobs = excluded.max_concurrent_jobs,
          presentation = excluded.presentation,
          sort_order = excluded.sort_order,
          is_active = true
        where
          plans.name is distinct from excluded.name
          or plans.tier is distinct from excluded.tier
          or plans.micro_credits_per_term is distinct from excluded.micro_credits_per_term
          or plans.term_days is distinct from excluded.term_days
          or plans.price_amount is distinct from excluded.price_amount
          or plans.currency is distinct from excluded.currency
          or plans.annual_price_amount is distinct from excluded.annual_price_amount
          or plans.max_resolution_px is distinct from excluded.max_resolution_px
          or plans.max_concurrent_jobs is distinct from excluded.max_concurrent_jobs
          or plans.presentation is distinct from excluded.presentation
          or plans.sort_order is distinct from excluded.sort_order
          or plans.is_active is distinct from true
        returning id
      `;
      if (changed) written += 1;
    }

    // A plan pulled from the ladder stops being sold. Deactivated rather than
    // deleted: subscriptions and orders point at these rows, and a plan nobody
    // can buy any more is still a plan somebody is on.
    const retired = await tx<{ code: string }[]>`
      update plans set is_active = false, is_public = false
      where is_active and not (code = any(${rows.map((row) => row.code)}::text[]))
      returning code
    `;

    // Effective-dated like model_prices: never an UPDATE, always close the old
    // row and open a new one. A quote points at the rate it was shown, and
    // rewriting that row in place would retroactively change what a customer
    // was told last week.
    const [liveRate] = await tx<{ rate: string }[]>`
      select rate from fx_rates
      where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
      limit 1
    `;
    let rateChanged = false;
    if (Number(liveRate?.rate) !== IRR_PER_USD) {
      await tx`
        update fx_rates set valid_to = now()
        where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
      `;
      await tx`
        insert into fx_rates (base_currency, quote_currency, rate, source)
        values ('USD', 'IRR', ${IRR_PER_USD}, 'manual')
      `;
      rateChanged = true;
    }

    return { written, retired: retired.length, total: rows.length, rateChanged };
  });

  const rate = summary.rateChanged ? `, fx rate set to ${IRR_PER_USD} IRR/USD` : "";
  if (summary.written === 0 && summary.retired === 0 && !summary.rateChanged) {
    console.log(`plans already current: ${summary.total} plans, nothing written`);
  } else {
    console.log(`published ${summary.total} plans (${summary.written} written, ${summary.retired} retired)${rate}`);
  }
} finally {
  await sql.end();
}
