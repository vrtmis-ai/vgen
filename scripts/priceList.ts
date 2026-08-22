/**
 * The one definition of which price fields a browser may see.
 *
 * Shared by the generator and the check so they cannot disagree — a generator
 * that stripped a field the check did not know about would pass while shipping
 * it, which is the failure mode this file exists to remove.
 */

export interface FullPriceRow {
  variantId: string;
  /** The supplier's own path. Server-only. */
  externalModelId: string;
  featureCode: string;
  selector: Record<string, string>;
  pricingMode: "fixed" | "derived";
  quantity: "none" | "seconds" | "characters";
  /** What a generation costs us, in the supplier's unit. Server-only. */
  providerUnits: number;
  microCredits: number;
  maxBillableUnits: number | null;
  isOffered: boolean;
}

export type PublicPriceRow = Omit<FullPriceRow, "externalModelId" | "providerUnits">;

export const PUBLIC_PRICE_FIELDS = [
  "variantId",
  "featureCode",
  "selector",
  "pricingMode",
  "quantity",
  "microCredits",
  "maxBillableUnits",
  "isOffered",
] as const satisfies readonly (keyof PublicPriceRow)[];

/** Drops every field a customer has no business reading, and nothing else. */
export function reducePriceRows(rows: readonly FullPriceRow[]): PublicPriceRow[] {
  return rows.map((row) => {
    const { externalModelId: _path, providerUnits: _cost, ...rest } = row;
    return rest;
  });
}
