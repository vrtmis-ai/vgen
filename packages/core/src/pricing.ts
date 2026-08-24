/* ---------------------------------------------------------------------------
   The coin arithmetic.

   The rate table that used to live here — 44 functions keyed by variant id —
   is gone. Prices are rows now: `model_prices` in Postgres, seeded from
   `src/data/pricing.rows.json`, resolved by `priceResolution.ts`. A price
   change is a row, not a deploy.

   What is left is the economics: the conversions between what we pay a
   provider, what a coin is worth, and what the ledger stores.

   This lives in @vgen/core rather than in the web app because the SERVER has to
   price a generation. A quote written from a number the browser sent is a quote
   the user can edit; the only trustworthy price is one the API derives itself.
   Both sides now read this one table, so a rate change cannot land on the
   client and miss the ledger.

   Pure on purpose — no fetch, no DOM, no catalogue import. The web app layers
   KIE's live table over this at runtime (src/data/pricing.ts); the API uses it
   as-is, which is the conservative direction: the built-in figures are the
   published list prices, and KIE's live table only ever discounts them.

   Economics (locked):
     1 coin = $0.05 to the user · margin 2x · KIE credit = $0.005
     Billed in hundredths of a coin — see MICRO_CREDITS_PER_BILLED_STEP.
   --------------------------------------------------------------------------- */

export const KIE_CREDIT_USD = 0.005;
export const COIN_USD = 0.05;
export const MARGIN = 2;

/**
 * Months paid up front on the annual option.
 *
 * Here rather than in the web app because both halves multiply by it and they
 * must never disagree: the sheet multiplies to show a total, and the API
 * multiplies to charge one. If those two numbers ever differ, the customer is
 * quoted one figure and billed another — so this is a single constant, in the
 * package the browser and the server already share.
 *
 * Annual is a payment cadence and not a longer term. Twelve months are paid at
 * once; the coins still arrive month by month and still expire after 30 days,
 * which is where the annual discount comes from.
 */
export const ANNUAL_MONTHS = 12;

/**
 * Storage unit. A coin is what the customer sees; a micro-credit is what the
 * database stores, and every money column is BIGINT micro-credits so nothing in
 * the money path is ever a float.
 *
 * The two are not interchangeable and confusing them is a factor of a million,
 * so the conversions are named rather than written as bare arithmetic.
 */
export const MICRO_CREDITS_PER_COIN = 1_000_000;

export function coinsToMicroCredits(coins: number): number {
  if (!Number.isInteger(coins)) throw new RangeError(`Coins must be a whole number, received ${coins}`);
  return coins * MICRO_CREDITS_PER_COIN;
}

/**
 * The smallest slice of a coin a generation can be billed, in micro-credits.
 *
 * Prices used to round up to a whole coin. At the cheap end that rounding is
 * larger than the price itself: Z-Image costs $0.004, which is 0.16 of a coin,
 * and charging one whole coin for it is 6.25x the margin the economics above
 * name. The models it hurt most were the cheap ones — exactly the ones a plan's
 * headline output count is quoted from.
 *
 * Nothing in storage ever needed the whole coin: the ledger has been BIGINT
 * micro-credits from the start, and `model_prices` already holds exact
 * sub-coin rates (Flux 2 Flex is 2_800_000, not 3_000_000). The whole coin was
 * a display convention that reached into the money path.
 *
 * A hundredth of a coin is fine enough that no offered model rounds up by more
 * than a fraction of a percent, and coarse enough that a quote is two decimal
 * places rather than a float tail. Rounding is still upward — the only
 * direction that cannot sell a job below cost.
 */
export const MICRO_CREDITS_PER_BILLED_STEP = MICRO_CREDITS_PER_COIN / 100;

/** Micro-credits rounded up to the next billable step. */
export function roundUpToBilledStep(microCredits: number): number {
  return Math.ceil(microCredits / MICRO_CREDITS_PER_BILLED_STEP) * MICRO_CREDITS_PER_BILLED_STEP;
}

/**
 * Rounds toward the customer. A balance is shown to the step it can actually be
 * spent in, never up, so it never reads as more than it can buy. Flooring to a
 * whole coin would now hide real money: a wallet holding 0.9 of a coin can pay
 * for five Z-Image runs, and displaying that as zero is wrong in the direction
 * that makes a customer top up when they did not need to.
 */
export function microCreditsToCoins(microCredits: number): number {
  return (Math.floor(microCredits / MICRO_CREDITS_PER_BILLED_STEP) * MICRO_CREDITS_PER_BILLED_STEP) / MICRO_CREDITS_PER_COIN;
}

/**
 * What a generation costs in storage units.
 *
 * The multiplication is rounded to a whole micro-credit before the step ceil:
 * `0.004 * 2 / 0.05 * 1e6` lands on 160000.00000000003 in binary floating
 * point, and a bare ceil on that noise would bill 0.17 of a coin for a price
 * that is exactly 0.16. A micro-credit is $0.00000005, so the rounding cannot
 * move real money — it only deletes the float tail.
 */
export function microCreditsFor(costUsd: number): number {
  return roundUpToBilledStep(Math.round((costUsd * MARGIN * MICRO_CREDITS_PER_COIN) / COIN_USD));
}

export function microCreditsForKieCredits(credits: number): number {
  return microCreditsFor(credits * KIE_CREDIT_USD);
}

/** Coins we charge for a generation that costs us `costUsd` at the provider. */
export function coinsFor(costUsd: number): number {
  return microCreditsFor(costUsd) / MICRO_CREDITS_PER_COIN;
}

/** Same, for a provider that quotes in KIE credits. */
export function coinsForKieCredits(credits: number): number {
  return coinsFor(credits * KIE_CREDIT_USD);
}
