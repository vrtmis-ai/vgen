import type { Sql, TransactionSql } from "postgres";

/**
 * The one USD→IRR rate everything else is priced through.
 *
 * `fx_rates` was always effective-dated and always read by the money paths —
 * `quotesRepository` stamps every quote with the rate it was shown at and
 * `checkoutRepository` stamps every order with the row it was charged at — but
 * the number itself came from a constant compiled into the browser bundle and
 * copied into the table by `pnpm plans:publish`. A constant does not track a
 * currency that moves several percent a week, so what a plan cost in Toman was
 * whatever the rate happened to be on the day somebody last edited that line.
 *
 * These two functions are the only writers. Both close the live row and open a
 * new one rather than updating in place: a quote points at the rate it quoted,
 * and rewriting that row would retroactively change what a customer was told.
 *
 * Rial, not Toman, everywhere in this file. The column says IRR, the two differ
 * by a factor of ten, and getting it backwards under-charges by 90%.
 */

export interface LiveRate {
  id: string;
  /** Rial per dollar. Toman is this over ten, and is display only. */
  rialPerUsd: number;
  /** When this rate became the live one — what the refresh interval measures. */
  validFrom: Date;
  /** Who said so: a market ('wallex'), or a placeholder ('seed', 'manual'). */
  source: string | null;
}

type Queryable = Sql | TransactionSql;

/** The rate in force now, or null on a database nobody has seeded. */
export async function liveRate(sql: Queryable): Promise<LiveRate | null> {
  const [row] = await sql<{ id: string; rate: string; valid_from: Date; source: string | null }[]>`
    select id, rate, valid_from, source
    from fx_rates
    where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
    limit 1
  `;
  return row ? { id: row.id, rialPerUsd: Number(row.rate), validFrom: row.valid_from, source: row.source } : null;
}

/**
 * Open a new live rate, closing the one it replaces.
 *
 * Must run inside a transaction: `fx_rates` has a unique index on
 * (base_currency, quote_currency) WHERE valid_to IS NULL, so the close and the
 * insert are one atomic swap or they are a constraint violation. That index is
 * also what makes two worker replicas safe — the loser's insert fails and its
 * whole transaction rolls back, rather than both rates going live.
 *
 * Returns false when the rate is unchanged, so a daily refresh that finds the
 * same number leaves the history alone instead of writing a row a second.
 */
export async function setRate(tx: TransactionSql, rialPerUsd: number, source: string): Promise<boolean> {
  if (!Number.isFinite(rialPerUsd) || rialPerUsd <= 0) {
    throw new Error(`refusing to set a USD/IRR rate of ${rialPerUsd}`);
  }
  const current = await liveRate(tx);
  if (current?.rialPerUsd === rialPerUsd) return false;

  await tx`
    update fx_rates set valid_to = now()
    where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
  `;
  await tx`
    insert into fx_rates (base_currency, quote_currency, rate, source)
    values ('USD', 'IRR', ${rialPerUsd}, ${source})
  `;
  return true;
}

/**
 * Put a rate in an empty table, and never touch a rate that is already there.
 *
 * This is what `pnpm plans:publish` calls. It used to call the equivalent of
 * `setRate`, which meant every reseed of the catalogue stamped the compiled-in
 * constant back over whatever the daily refresh had fetched — a deploy silently
 * reverting the price of everything to what the rate was in July.
 *
 * Seeding is still worth doing: `quotes.exchange_rate_irr_per_usd` is NOT NULL,
 * so a database with no rate cannot quote a generation at all, and the worker's
 * first refresh is up to an hour after boot.
 */
export async function seedRate(tx: TransactionSql, rialPerUsd: number, source: string): Promise<boolean> {
  if (await liveRate(tx)) return false;
  return setRate(tx, rialPerUsd, source);
}
