import postgres, { type Sql } from "postgres";
import { FxRateUnavailableError, MAX_DAILY_MOVE, fetchTomanPerUsd, isPlausibleMove } from "@vgen/adapters";
import { liveRate, setRate } from "@vgen/db";

/**
 * Keep `fx_rates` tracking the market, once a day.
 *
 * The rate used to be a constant — `TOMAN_PER_USD = 170_000`, set by hand in
 * July — copied into the table by the plan seeder. Everything downstream was
 * already honest about it: a quote records the rate it quoted, an order records
 * the row it was charged at. Only the number was wrong, and by the time this
 * was written it was wrong by 28%.
 *
 * It lives in the worker because the worker is the process that already runs on
 * a timer, already holds a Postgres pool, and can reach the internet. pg_cron
 * runs five jobs in this database and would have been the obvious home, except
 * that it cannot make an HTTP request.
 *
 * Also runnable by hand — `pnpm fx:refresh`, `--force` to override the
 * plausibility band — which is the way out of the one trap the band sets.
 */

/**
 * Refresh when the live rate is this old, checked hourly.
 *
 * Twenty rather than twenty-four so the daily refresh does not drift an hour
 * later every day until it lands in the middle of the evening.
 */
const REFRESH_AFTER_MS = 20 * 60 * 60 * 1000;

/** Rial per Toman. The column is IRR; every price a customer sees is Toman. */
const IRR_PER_TOMAN = 10;

/**
 * Sources that are a placeholder rather than a measurement, and are therefore
 * due for replacement the moment this runs, however recently they were written.
 *
 * Without this, `pnpm plans:publish` on a fresh database would seed 170,000 and
 * the age check would then protect that number for the next twenty hours — a
 * deploy spending most of a day quoting a price 28% under the market, which is
 * the exact failure the daily refresh exists to end. `manual` is here for the
 * same reason: the rows this replaced were written by hand.
 */
const PLACEHOLDER_SOURCES = new Set(["seed", "manual"]);

export type RefreshOutcome =
  | { outcome: "written"; tomanPerUsd: number; previousTomanPerUsd: number | null }
  | { outcome: "unchanged"; tomanPerUsd: number }
  | { outcome: "not_due"; tomanPerUsd: number; ageHours: number }
  | { outcome: "implausible"; tomanPerUsd: number; currentTomanPerUsd: number }
  | { outcome: "unavailable"; reason: string };

export interface RefreshOptions {
  /** Fetch and write even if the rate is fresh and the move is out of band. */
  force?: boolean;
  fetchImpl?: typeof fetch;
}

/**
 * One refresh attempt. Never throws for an unreachable source.
 *
 * A source that is down is not an incident: the previous rate stays live and
 * the next hour tries again. It returns an outcome instead so the caller can
 * decide how loudly to say so — the timer logs it, the CLI exits non-zero.
 *
 * The whole read-decide-write runs in one transaction with the live row locked,
 * so two worker replicas cannot both decide the rate is due and both write. The
 * unique partial index on `fx_rates` would catch that anyway, but as a crash
 * rather than as coordination.
 */
export async function refreshFxRate(sql: Sql, options: RefreshOptions = {}): Promise<RefreshOutcome> {
  return sql.begin(async (tx) => {
    // Taken before the fetch, and held across it. The lock is the point: a
    // second replica waits here rather than racing to the same conclusion.
    await tx`
      select id from fx_rates
      where base_currency = 'USD' and quote_currency = 'IRR' and valid_to is null
      for update
    `;
    const current = await liveRate(tx);
    const currentToman = current === null ? null : current.rialPerUsd / IRR_PER_TOMAN;

    if (!options.force && current !== null && !PLACEHOLDER_SOURCES.has(current.source ?? "")) {
      const ageMs = Date.now() - current.validFrom.getTime();
      if (ageMs < REFRESH_AFTER_MS) {
        return { outcome: "not_due", tomanPerUsd: currentToman ?? 0, ageHours: Math.round(ageMs / 3_600_000) };
      }
    }

    let fetched;
    try {
      fetched = await fetchTomanPerUsd(options.fetchImpl);
    } catch (error) {
      if (error instanceof FxRateUnavailableError) return { outcome: "unavailable", reason: error.message };
      throw error;
    }

    if (!options.force && !isPlausibleMove(fetched.tomanPerUsd, currentToman)) {
      // Deliberately not written. See MAX_DAILY_MOVE: this refuses a decimal
      // slip and a flash print, and the same refusal will repeat every hour
      // until someone looks, which is the intended amount of noise.
      return { outcome: "implausible", tomanPerUsd: fetched.tomanPerUsd, currentTomanPerUsd: currentToman ?? 0 };
    }

    // A whole number of Toman times ten, so the Rial stored and the Toman the
    // browser is served are exactly a factor of ten apart. The plan card and
    // the checkout each round a price to the nearest thousand Toman from their
    // own copy of this, and the sheet warns the customer if the two disagree.
    const written = await setRate(tx, fetched.tomanPerUsd * IRR_PER_TOMAN, fetched.source);
    return written
      ? { outcome: "written", tomanPerUsd: fetched.tomanPerUsd, previousTomanPerUsd: currentToman }
      : { outcome: "unchanged", tomanPerUsd: fetched.tomanPerUsd };
  }) as Promise<RefreshOutcome>;
}

/** How often the worker asks. The rate's own age decides whether anything happens. */
export const FX_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export { MAX_DAILY_MOVE, REFRESH_AFTER_MS };

/* ------------------------------------------------------------------ */
/* pnpm fx:refresh [--force]                                          */

if (process.argv[1]?.replace(/\\/g, "/").endsWith("apps/worker/src/fxRefresh.ts")) {
  const { config } = await import("dotenv");
  const { fileURLToPath } = await import("node:url");
  config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
  config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required to refresh the exchange rate");

  const cli = postgres(databaseUrl, { max: 1 });
  try {
    const result = await refreshFxRate(cli, { force: process.argv.includes("--force") });
    console.log(JSON.stringify(result));
    // Non-zero for the two outcomes a human needs to do something about. "Not
    // due" and "unchanged" are successes: nothing needed doing.
    if (result.outcome === "unavailable" || result.outcome === "implausible") process.exitCode = 1;
  } finally {
    await cli.end();
  }
}
