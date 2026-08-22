import type { Plan } from "@vgen/contracts";
import { microCreditsToCoins } from "@vgen/core";
import type { Sql } from "postgres";
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
    monthlyUsd: Number(row.price_amount),
    annualUsdPerMonth: row.annual_price_amount === null ? null : Number(row.annual_price_amount),
    group: row.presentation.group === "main" ? "main" : "entry",
    ...(row.presentation.tag ? { tag: row.presentation.tag as NonNullable<Plan["tag"]> } : {}),
    popular: row.presentation.popular === true,
    maxConcurrentJobs: row.max_concurrent_jobs,
  };
}

const SELECT_COLUMNS = `
  code, name, tier, micro_credits_per_term, term_days,
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
      return fingerprintOf(row?.n ?? "0", row?.newest);
    },
    () => this.build(),
  );

  /** Everything on sale, in the order the cards are meant to read. */
  async list(): Promise<Plan[]> {
    return this.document.get();
  }

  private async build(): Promise<Plan[]> {
    const rows = await this.sql<PlanRow[]>`
      select ${this.sql.unsafe(SELECT_COLUMNS)}
      from plans
      where is_active and is_public
      order by sort_order asc
    `;
    return rows.map(toPlan);
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
