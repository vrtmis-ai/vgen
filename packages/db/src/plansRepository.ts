import type { Plan, PlansResponse } from "@vgen/contracts";
import { microCreditsToCoins } from "@vgen/core";
import type { Sql } from "postgres";
import { liveRate } from "./fxRepository";
import { PublicDocument, fingerprintOf } from "./publicDocument";

/**
 * The plan ladder, read from the table that bills for it.
 *
 * `src/data/plans.ts` used to be the only copy, which meant the card a customer
 * bought from and the row a subscription pointed at were two different facts
 * that happened to agree. They agree by construction now.
 */

interface PlanRow {
  code: string;
  name: string;
  tier: number;
  micro_credits_per_term: string;
  term_days: number;
  unlimited_days: number;
  price_amount: string;
  annual_price_amount: string | null;
  max_concurrent_jobs: number;
  presentation: {
    group?: string;
    tag?: string;
    popular?: boolean;
    baseCoins?: number;
    bonusCoins?: number;
  };
}

function toPlan(row: PlanRow): Plan {
  const coinsPerTerm = microCreditsToCoins(Number(row.micro_credits_per_term));
  const baseCoins = row.presentation.baseCoins ?? coinsPerTerm;
  return {
    code: row.code,
    name: row.name,
    // The column is CHECKed to 1..3, so this narrowing is the schema's promise
    // rather than an assumption made here.
    tier: row.tier as Plan["tier"],
    coinsPerTerm,
    baseCoins,
    bonusCoins: row.presentation.bonusCoins ?? coinsPerTerm - baseCoins,
    termDays: row.term_days,
    unlimitedDays: row.unlimited_days,
    monthlyUsd: Number(row.price_amount),
    annualUsdPerMonth: row.annual_price_amount === null ? null : Number(row.annual_price_amount),
    group: row.presentation.group === "main" ? "main" : "entry",
    ...(row.presentation.tag ? { tag: row.presentation.tag as NonNullable<Plan["tag"]> } : {}),
    popular: row.presentation.popular === true,
    maxConcurrentJobs: row.max_concurrent_jobs,
  };
}

const SELECT_COLUMNS = `
  code, name, tier, micro_credits_per_term, term_days, unlimited_days,
  price_amount, annual_price_amount, max_concurrent_jobs, presentation
`;

export class PostgresPlansRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Rebuilt only when a plan changes. See `PublicDocument`.
   *
   * The pricing table is the least volatile thing the API serves and was being
   * assembled from scratch several thousand times a second under load.
   * Withdrawing a plan is the case the count catches: `is_public` flips, the
   * row leaves the set, and the newest timestamp among what remains is
   * unchanged.
   */
  private readonly document = new PublicDocument(
    async () => {
      const [row] = await this.sql<{ n: string; newest: Date | null }[]>`
        select count(*)::text as n, max(updated_at) as newest
        from plans where is_active and is_public
      `;
      // The live exchange rate is part of this document now, so it is part of
      // the fingerprint. Its `valid_from` alone would do — the table is
      // effective-dated, so a new rate is always a new row with a new stamp —
      // but the rate itself is in there as the same belt-and-braces the count
      // above is: a fingerprint that cannot see a change serves a stale price.
      const [fx] = await this.sql<{ rate: string; valid_from: Date }[]>`
        select rate, valid_from from fx_rates
        where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
        limit 1
      `;
      return fingerprintOf(`${row?.n ?? "0"}/${fx?.rate ?? "none"}`, row?.newest, fx?.valid_from);
    },
    () => this.build(),
  );

  /** Everything on sale, in the order the cards are meant to read. */
  async list(): Promise<PlansResponse> {
    return this.document.get();
  }

  private async build(): Promise<PlansResponse> {
    const rows = await this.sql<PlanRow[]>`
      select ${this.sql.unsafe(SELECT_COLUMNS)}
      from plans
      where is_active and is_public
      order by sort_order asc
    `;
    const fx = await liveRate(this.sql);
    // A ladder with no rate cannot be priced, and serving it anyway would put
    // plan cards on screen showing a Toman figure derived from nothing. The
    // seeder guarantees a row exists; this is what says so out loud when it
    // does not, rather than three screens rendering NaN.
    if (fx === null) throw new Error("no live USD/IRR rate in fx_rates; run pnpm plans:publish");
    return { plans: rows.map(toPlan), tomanPerUsd: fx.rialPerUsd / 10 };
  }

  /**
   * The tier an account holds, for the gate.
   *
   * An account with no plan is tier 1, not tier 0. A new account holds a 12-coin
   * signup gift and the cheapest tier-1 models cost about a coin, so tier 1 is
   * what makes that gift a trial someone can spend rather than a number they
   * cannot. An unknown or retired plan code falls back the same way — failing
   * closed here would lock out a customer mid-subscription over a typo.
   */
  async tierFor(planCode: string | null | undefined): Promise<1 | 2 | 3> {
    if (!planCode) return 1;
    const [row] = await this.sql<{ tier: number }[]>`
      select tier from plans where code = ${planCode} limit 1
    `;
    return (row?.tier as 1 | 2 | 3 | undefined) ?? 1;
  }

  /**
   * The cheapest plan that reaches a tier — what a lock should point at.
   *
   * Cheapest rather than "the next tier up", because tiers are not a price
   * ladder: Plus is tier 1 at $25 while Pro is tier 2 at $49, so naming a tier
   * tells a customer nothing about what to buy.
   */
  async cheapestForTier(tier: number): Promise<Plan | null> {
    const [row] = await this.sql<PlanRow[]>`
      select ${this.sql.unsafe(SELECT_COLUMNS)}
      from plans
      where is_active and is_public and tier >= ${tier}
      order by price_amount asc
      limit 1
    `;
    return row ? toPlan(row) : null;
  }
}
