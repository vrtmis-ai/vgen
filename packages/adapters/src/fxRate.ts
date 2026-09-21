/**
 * What a dollar costs in Toman today, from a market that actually trades one.
 *
 * There is no official USD/IRR rate a business here can buy at, so the number
 * that matters is the free-market one. Wallex is an Iranian exchange whose
 * USDT/TMN book is quoted in Toman directly and whose public market endpoint
 * needs no key. Checked against tgju's free-market dollar on the day this was
 * written: 235,854 against 235,975, a fifth of a percent apart — which is the
 * cross-check that says the source is measuring the right thing.
 *
 * `api.nobitex.ir`, named in the `fx_rates.source` comment as an option, does
 * not resolve from the production host at all. tgju answers, but its endpoint
 * returns a rendered table with markup in the cells; Wallex returns a number.
 *
 * One source, no fallback chain. A source that is down means the previous rate
 * stays live for another day, which is a correct and safe outcome — a price
 * that is a day stale is not a price that is wrong. Add a second source if this
 * one proves flaky, not before.
 */

const WALLEX_MARKETS = "https://api.wallex.ir/v1/markets";

/** USDT/Toman. The pair, spelled the way Wallex spells it. */
const SYMBOL = "USDTTMN";

/**
 * How far one day's rate may move from the last before it is refused.
 *
 * Sized against the two things it has to tell apart. A Rial figure mistaken for
 * a Toman one is out by 1000%, and a flash print on a thin book can be out by
 * any amount; the Toman itself moves a few percent on a bad week and got
 * nowhere near 20% in a day even through 2025's worst. So 20% passes every real
 * move and catches every unit error.
 *
 * It fails closed, which has its own trap: if the market genuinely gaps past
 * this, every subsequent day compares against the frozen rate and refuses too.
 * `pnpm fx:refresh --force` is the way out, and the refusal logs loudly enough
 * to send someone to it.
 */
const MAX_DAILY_MOVE = 0.2;

export interface FetchedRate {
  /** Toman per dollar, rounded to a whole Toman. */
  tomanPerUsd: number;
  /** For `fx_rates.source`. */
  source: string;
}

export class FxRateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FxRateUnavailableError";
  }
}

/**
 * The rate, or a throw. Never a guess and never zero.
 *
 * A whole number of Toman because the Rial figure stored is this times ten, and
 * the browser is served this figure back: keeping the two exactly a factor of
 * ten apart is what makes the price on the plan card and the price the checkout
 * reserves round to the same thousand. A fractional Toman here would put them
 * one apart often enough to matter, and the checkout sheet warns the customer
 * when they disagree.
 */
export async function fetchTomanPerUsd(fetchImpl: typeof fetch = fetch): Promise<FetchedRate> {
  let payload: unknown;
  try {
    const response = await fetchImpl(WALLEX_MARKETS, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new FxRateUnavailableError(`wallex answered ${response.status}`);
    payload = await response.json();
  } catch (error) {
    if (error instanceof FxRateUnavailableError) throw error;
    throw new FxRateUnavailableError(error instanceof Error ? error.message : "wallex is unreachable");
  }

  // Walked rather than destructured: this is a third party's JSON, and the
  // shape being wrong is exactly the failure this function exists to refuse.
  const symbols = (payload as { result?: { symbols?: Record<string, { stats?: { lastPrice?: unknown } }> } })?.result?.symbols;
  const raw = symbols?.[SYMBOL]?.stats?.lastPrice;
  const price = typeof raw === "string" || typeof raw === "number" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(price) || price <= 0) {
    throw new FxRateUnavailableError(`wallex has no usable ${SYMBOL} price (${JSON.stringify(raw)?.slice(0, 60)})`);
  }
  return { tomanPerUsd: Math.round(price), source: "wallex" };
}

/**
 * Whether a freshly fetched rate is close enough to the live one to trust.
 *
 * Separate from the fetch so the band is testable without a network, and so the
 * caller decides what to do about a refusal — the worker logs and keeps the old
 * rate, the manual script can be told to override it.
 */
export function isPlausibleMove(next: number, current: number | null): boolean {
  if (current === null || current <= 0) return true;
  return Math.abs(next - current) / current <= MAX_DAILY_MOVE;
}

export { MAX_DAILY_MOVE };
