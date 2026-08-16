// What a generation costs, for the screens that have to show a number before
// the user commits to it.
//
// This used to be 44 rate functions plus a live overlay fetched from KIE. Both
// are gone. Prices are rows now — `model_prices` in Postgres, seeded from
// `pricing.rows.json`, which is the same list this file reads. The server
// prices from the table and the browser prices from the list the table was
// built from, through the one algorithm in @vgen/core, so the number under the
// Create button and the number the ledger charges cannot disagree.
//
// The browser reading a committed copy is deliberate and temporary. A price
// shown before submitting has to render without a round trip, and
// `POST /generation/quotes` does not exist yet. When it does, these screens ask
// the server and this file goes; until then the copy is generated, never
// hand-edited, and a CI check pins it to the database.
//
// Economics (locked):
//   1 coin = $0.05 to the user · margin 2x · KIE credit = $0.005
//
// The pivot is USD, not provider credits, so adding a second provider does not
// touch the coin economy.

import { isRefusal, resolvePrice, type PriceRowLike } from "@vgen/core";
import priceList from "./pricing.rows.json";
import { defaultInput, variantControls, type Family, type Variant } from "./models";
import type { InputMap } from "../components/controls";

export { KIE_CREDIT_USD, COIN_USD, MARGIN, MICRO_CREDITS_PER_COIN, coinsFor, coinsForKieCredits } from "@vgen/core";

/**
 * What the caller knows that the settings do not say.
 *
 * `chars` is the prompt length, for the speech models billed by it. Kept as a
 * separate argument rather than folded into the settings because it is not a
 * control the user sets — it is a consequence of what they typed.
 */
export interface PriceCtx {
  chars: number;
  clipSeconds: number;
}

export const NO_CTX: PriceCtx = { chars: 0, clipSeconds: 0 };

interface StoredRow {
  variantId: string;
  selector: Record<string, string>;
  pricingMode: "fixed" | "derived";
  quantity: "none" | "seconds" | "characters";
  providerUnits: number;
  microCredits: number;
  maxBillableUnits: number | null;
  isOffered: boolean;
}

/** Grouped once at module load; the list is static and every screen reads it. */
const ROWS_BY_VARIANT = new Map<string, PriceRowLike[]>();
for (const row of (priceList as { rows: StoredRow[] }).rows) {
  const shaped: PriceRowLike = {
    selector: row.selector,
    pricingMode: row.pricingMode,
    isOffered: row.isOffered,
    providerUnitsBase: row.quantity === "none" ? row.providerUnits : 0,
    providerUnitsPerSecond: row.quantity === "seconds" ? row.providerUnits : 0,
    providerUnitsPer1kInput: row.quantity === "characters" ? row.providerUnits : 0,
    microCreditsBase: row.quantity === "none" ? row.microCredits : 0,
    microCreditsPerSecond: row.quantity === "seconds" ? row.microCredits : 0,
    microCreditsPer1kInput: row.quantity === "characters" ? row.microCredits : 0,
    maxBillableUnits: row.maxBillableUnits,
  };
  ROWS_BY_VARIANT.set(row.variantId, [...(ROWS_BY_VARIANT.get(row.variantId) ?? []), shaped]);
}

/**
 * Billable seconds for a variant, which is not always the duration control.
 *
 * A duration of zero means "keep the whole source clip" on the video editors, so
 * the length then comes from the file the user attached and is not known until
 * it lands. The upscalers and Motion Control have no duration control at all.
 */
function billableSeconds(input: InputMap, ctx: PriceCtx): number {
  const duration = Number(input.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : ctx.clipSeconds;
}

/** Coins for a generation, or null when the combination cannot be priced or sold. */
export function priceCoins(variant: Variant, input: InputMap, ctx: PriceCtx = NO_CTX): number | null {
  return coinsForVariantId(variant.id, input, ctx);
}

/**
 * The same, for a caller holding an id rather than the variant.
 *
 * `plans.ts` prices its estimate anchors this way: it names two models by id to
 * work out what a plan's coins buy, and importing the whole catalogue to look
 * up an object it already knows the id of would be a cycle.
 */
export function coinsForVariantId(variantId: string, input: InputMap, ctx: PriceCtx = NO_CTX): number | null {
  const rows = ROWS_BY_VARIANT.get(variantId);
  if (!rows) return null;
  const outcome = resolvePrice(rows, { params: input, seconds: billableSeconds(input, ctx), characters: ctx.chars });
  return isRefusal(outcome) ? null : outcome.coins;
}

/** The cheapest a family can be run for, for the "from N coins" line on Landing. */
export function minCoinsForFamily(family: Family): number | null {
  const prices = family.variants
    .map((variant) => priceCoins(variant, defaultInput(variantControls(family, variant)), NO_CTX))
    .filter((coins): coins is number => coins !== null);
  return prices.length ? Math.min(...prices) : null;
}
