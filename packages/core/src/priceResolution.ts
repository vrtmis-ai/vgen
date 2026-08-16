import { MICRO_CREDITS_PER_COIN } from "./pricing";

/**
 * One pricing algorithm, over rows that come from wherever.
 *
 * The server reads its rows from `model_prices`; the browser reads the same
 * rows from the committed list they were seeded from. Both then price through
 * this, so the number under the Create button and the number the ledger charges
 * cannot drift apart — which is the whole reason the rate functions this
 * replaced had to go. They were 44 closures compiled into the bundle, and the
 * API had to be trusted to reimplement them identically.
 *
 * Pure: no database, no fetch, no catalogue import.
 */

/** The selector-bearing subset of a price row that pricing actually reads. */
export interface PriceRowLike {
  selector: Record<string, string>;
  pricingMode: "fixed" | "derived";
  isOffered: boolean;
  providerUnitsBase: number;
  providerUnitsPerSecond: number;
  providerUnitsPer1kInput: number;
  microCreditsBase: number;
  microCreditsPerSecond: number;
  microCreditsPer1kInput: number;
  maxBillableUnits: number | null;
}

export interface PriceInputs {
  params: Record<string, unknown>;
  /** Billable seconds — the duration control, or the attached clip's length. */
  seconds?: number | undefined;
  /** Characters of text, for the models that bill by length. */
  characters?: number | undefined;
}

export interface PriceOutcome {
  coins: number;
  microCredits: number;
  providerUnits: number;
}

/** Why a set of settings has no price. Distinct answers, distinct handling. */
export type PriceRefusal = "not_offered" | "no_matching_row" | "missing_quantity";

/** Speech is billed in blocks of a thousand characters, and never fewer than one. */
export const CHARACTER_BLOCK = 1000;

/**
 * The row whose selector the settings satisfy, preferring the most specific.
 *
 * A selector names only the settings that move the price, so this is
 * containment rather than equality — a request carries every control the user
 * touched, and most prices depend on one or two. Specificity breaks ties: a
 * model with an unconditional `{}` row and a `{"resolution":"4k"}` row must
 * charge the 4k price for a 4k job, with the general row as the fallback.
 */
export function matchPriceRow<T extends PriceRowLike>(rows: readonly T[], params: Record<string, unknown>): T | null {
  const matches = rows.filter((row) => Object.entries(row.selector).every(([key, value]) => String(params[key]) === value));
  if (matches.length === 0) return null;
  return matches.reduce((best, row) => (Object.keys(row.selector).length > Object.keys(best.selector).length ? row : best));
}

export function resolvePrice(rows: readonly PriceRowLike[], inputs: PriceInputs): PriceOutcome | PriceRefusal {
  const row = matchPriceRow(rows, inputs.params);
  if (!row) return "no_matching_row";
  if (!row.isOffered) return "not_offered";

  let microCredits: number;
  let providerUnits: number;

  if (row.pricingMode === "fixed") {
    microCredits = row.microCreditsBase;
    providerUnits = row.providerUnitsBase;
  } else if (row.microCreditsPerSecond > 0) {
    const supplied = inputs.seconds ?? 0;
    if (supplied <= 0) return "missing_quantity";
    // Capped where the provider renders less than it is handed. Kling's Motion
    // Control returns at most 10s from an image and 30s from a video; seconds
    // past that are uploaded and discarded, and billing for them would charge
    // for output that does not exist.
    const billable = row.maxBillableUnits === null ? supplied : Math.min(supplied, row.maxBillableUnits);
    microCredits = row.microCreditsPerSecond * billable;
    providerUnits = row.providerUnitsPerSecond * billable;
  } else if (row.microCreditsPer1kInput > 0) {
    const blocks = Math.max(1, Math.ceil((inputs.characters ?? 0) / CHARACTER_BLOCK));
    microCredits = row.microCreditsPer1kInput * blocks;
    providerUnits = row.providerUnitsPer1kInput * blocks;
  } else {
    return "missing_quantity";
  }

  // Charged in whole coins, because a whole coin is what the screen quoted.
  // Rounding up is the only direction that cannot sell a job below cost.
  const coins = Math.ceil(microCredits / MICRO_CREDITS_PER_COIN);
  return { coins, microCredits: coins * MICRO_CREDITS_PER_COIN, providerUnits };
}

export const isRefusal = (outcome: PriceOutcome | PriceRefusal): outcome is PriceRefusal => typeof outcome === "string";
