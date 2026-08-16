import type { Sql } from "postgres";
import { isRefusal, matchPriceRow, resolvePrice } from "@vgen/core";

/**
 * What a generation costs, resolved from the database rather than from a
 * constant compiled into the browser.
 *
 * The point of this file is that the server decides the price. A quote written
 * from a number the client sent is a number the client can edit, so the browser
 * is told what a job costs and is never asked.
 */

export class PriceUnavailableError extends Error {
  constructor(
    readonly code: "not_offered" | "no_price",
    message: string,
  ) {
    super(message);
    this.name = "PriceUnavailableError";
  }
}

export interface PriceRequest {
  providerModelId: string;
  featureId: string;
  /** The generation's settings. Only the ones a price is keyed on are used. */
  params: Record<string, unknown>;
  /** Billable seconds — the duration control, or the attached clip's length. */
  seconds?: number | undefined;
  /** Characters of text, for the speech models that bill by length. */
  characters?: number | undefined;
  /** Defaults to now. Supplied so a job can be re-priced as of when it ran. */
  at?: Date | undefined;
}

export interface ResolvedPrice {
  /** Goes on the quote and then the job, so a charge can always name its price. */
  priceId: string;
  coins: number;
  microCredits: number;
  /** What we expect to pay the provider, for the margin audit and reconciliation. */
  providerUnits: number;
}

interface PriceRow {
  id: string;
  selector: Record<string, string>;
  pricing_mode: "fixed" | "derived";
  is_offered: boolean;
  provider_units_base: string;
  provider_units_per_second: string;
  provider_units_per_1k_input_tokens: string;
  micro_credits_base: string;
  micro_credits_per_second: string;
  micro_credits_per_1k_input_tokens: string;
  max_billable_units: string | null;
}

export class PostgresPricingRepository {
  constructor(private readonly sql: Sql) {}

  /**
   * Every price in force for a model and feature at a moment in time.
   *
   * Effective-dating is a range test, not "the newest row": a row that has been
   * superseded has a `valid_to`, and one that has not yet started has a
   * `valid_from` in the future. Taking the latest by date would hand a customer
   * next month's price today.
   */
  private async liveRows(providerModelId: string, featureId: string, at: Date): Promise<PriceRow[]> {
    return this.sql<PriceRow[]>`
      select id, selector, pricing_mode, is_offered,
             provider_units_base, provider_units_per_second, provider_units_per_1k_input_tokens,
             micro_credits_base, micro_credits_per_second, micro_credits_per_1k_input_tokens,
             max_billable_units
      from model_prices
      where provider_model_id = ${providerModelId}
        and feature_id = ${featureId}
        and valid_from <= ${at}
        and (valid_to is null or valid_to > ${at})
    `;
  }

  async priceFor(request: PriceRequest): Promise<ResolvedPrice> {
    const at = request.at ?? new Date();
    const rows = await this.liveRows(request.providerModelId, request.featureId, at);
    if (rows.length === 0) {
      throw new PriceUnavailableError("no_price", "No price is in force for this model and feature");
    }

    // numeric and bigint both arrive as strings from the driver. Converted once,
    // here, so the shared resolver only ever sees numbers.
    const priced = rows.map((row) => ({
      id: row.id,
      selector: row.selector,
      pricingMode: row.pricing_mode,
      isOffered: row.is_offered,
      providerUnitsBase: Number(row.provider_units_base),
      providerUnitsPerSecond: Number(row.provider_units_per_second),
      providerUnitsPer1kInput: Number(row.provider_units_per_1k_input_tokens),
      microCreditsBase: Number(row.micro_credits_base),
      microCreditsPerSecond: Number(row.micro_credits_per_second),
      microCreditsPer1kInput: Number(row.micro_credits_per_1k_input_tokens),
      maxBillableUnits: row.max_billable_units === null ? null : Number(row.max_billable_units),
    }));

    const outcome = resolvePrice(priced, {
      params: request.params,
      seconds: request.seconds,
      characters: request.characters,
    });

    if (isRefusal(outcome)) {
      if (outcome === "not_offered") throw new PriceUnavailableError("not_offered", "That combination is not offered");
      if (outcome === "missing_quantity") {
        throw new PriceUnavailableError("no_price", "This model is billed per unit and no quantity was given");
      }
      throw new PriceUnavailableError("no_price", "No price covers those settings");
    }

    // Matched a second time only to name the row on the quote. The resolver
    // returns an amount, not a row, because the browser has no row ids.
    const row = matchPriceRow(priced, request.params)!;
    return { priceId: row.id, coins: outcome.coins, microCredits: outcome.microCredits, providerUnits: outcome.providerUnits };
  }
}
