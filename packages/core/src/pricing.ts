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
   --------------------------------------------------------------------------- */

export const KIE_CREDIT_USD = 0.005;
export const COIN_USD = 0.05;
export const MARGIN = 2;

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
 * Rounds toward the customer. A partial coin is displayed as the whole coin it
 * came out of, so a balance never reads as more than it can actually buy.
 */
export function microCreditsToCoins(microCredits: number): number {
  return Math.floor(microCredits / MICRO_CREDITS_PER_COIN);
}

/** Coins we charge for a generation that costs us `costUsd` at the provider. */
export function coinsFor(costUsd: number): number {
  return Math.ceil((costUsd * MARGIN) / COIN_USD);
}

/** Same, for a provider that quotes in KIE credits. */
export function coinsForKieCredits(credits: number): number {
  return coinsFor(credits * KIE_CREDIT_USD);
}

/**
 * What a generation costs in storage units.
 *
 * Deliberately routed through `coinsFor` rather than computing micro-credits
 * directly: the ceil to a whole coin is the price the customer was quoted, and
 * pricing to sub-coin precision here would charge a number no screen ever showed.
 */
export function microCreditsFor(costUsd: number): number {
  return coinsToMicroCredits(coinsFor(costUsd));
}

export function microCreditsForKieCredits(credits: number): number {
  return coinsToMicroCredits(coinsForKieCredits(credits));
}
