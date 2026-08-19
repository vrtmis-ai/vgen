/**
 * Seed `model_prices` from the catalogue's rate table.
 *
 * Effective-dated, which is the whole reason the table has `valid_from` and
 * `valid_to`: a price that changes does not overwrite the old one, it closes it
 * and opens a new row. A job priced last week can still say what it was charged
 * and why, which is the difference between a ledger and a guess.
 *
 * So re-running with an unchanged catalogue writes nothing at all. That is not
 * politeness — an unconditional insert would open a new price every run, and
 * every quote would cite a row that had existed for four seconds.
 *
 * Run: pnpm pricing:publish   (needs DATABASE_URL)
 */
import { config } from "dotenv";
import postgres from "postgres";
import { MARGIN } from "@vgen/core";
import priceList from "../src/data/pricing.rows.json" with { type: "json" };

/**
 * One price row as the committed list holds it.
 *
 * The list is the price list. It was generated once from the rate functions
 * that used to live in `packages/core`, and those are gone — a price is now a
 * line in a JSON file and a row in a table, not a branch inside a function that
 * had to be deployed to change. CI builds an empty database every run, so the
 * seed data has to be in the repository; this is where it is.
 */
interface PriceRow {
  variantId: string;
  externalModelId: string;
  featureCode: string;
  selector: Record<string, string>;
  pricingMode: "fixed" | "derived";
  quantity: "none" | "seconds" | "characters";
  providerUnits: number;
  microCredits: number;
  maxBillableUnits: number | null;
  isOffered: boolean;
}

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish pricing");

/** `margin_pct` is a markup, so 2x is +100%. */
const MARGIN_PCT = (MARGIN - 1) * 100;

const rows = (priceList as { rows: PriceRow[] }).rows;

/** The columns that decide whether a live row still says the right thing. */
interface Priced {
  pricing_mode: string;
  is_offered: boolean;
  provider_units_base: string;
  provider_units_per_second: string;
  provider_units_per_1k_input_tokens: string;
  micro_credits_base: string;
  micro_credits_per_second: string;
  micro_credits_per_1k_input_tokens: string;
  margin_pct: string;
  max_billable_units: string | null;
}

/** numeric comes back as a string, so compare as numbers or 8 and 8.000000 differ forever. */
const same = (a: Priced, b: Priced) =>
  a.pricing_mode === b.pricing_mode &&
  a.is_offered === b.is_offered &&
  Number(a.provider_units_base) === Number(b.provider_units_base) &&
  Number(a.provider_units_per_second) === Number(b.provider_units_per_second) &&
  Number(a.provider_units_per_1k_input_tokens) === Number(b.provider_units_per_1k_input_tokens) &&
  Number(a.micro_credits_base) === Number(b.micro_credits_base) &&
  Number(a.micro_credits_per_second) === Number(b.micro_credits_per_second) &&
  Number(a.micro_credits_per_1k_input_tokens) === Number(b.micro_credits_per_1k_input_tokens) &&
  Number(a.margin_pct) === Number(b.margin_pct) &&
  Number(a.max_billable_units ?? 0) === Number(b.max_billable_units ?? 0);

function intended(row: PriceRow): Priced {
  const perSecond = row.quantity === "seconds";
  const perChars = row.quantity === "characters";
  const flat = row.quantity === "none";
  return {
    pricing_mode: row.pricingMode,
    is_offered: row.isOffered,
    provider_units_base: String(flat ? row.providerUnits : 0),
    provider_units_per_second: String(perSecond ? row.providerUnits : 0),
    provider_units_per_1k_input_tokens: String(perChars ? row.providerUnits : 0),
    micro_credits_base: String(flat ? row.microCredits : 0),
    micro_credits_per_second: String(perSecond ? row.microCredits : 0),
    micro_credits_per_1k_input_tokens: String(perChars ? row.microCredits : 0),
    margin_pct: String(MARGIN_PCT),
    max_billable_units: row.maxBillableUnits === null ? null : String(row.maxBillableUnits),
  };
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    // Catalogue rows, not one vendor's rows. `provider.code = 'kie'` was the
    // same set while KIE was the only provider; now that a second one has
    // serving models in this table it would silently mean "price everything
    // except anything routed elsewhere". What this always meant is: price what
    // is in the shop.
    const models = await tx<{ id: string; external_model_id: string }[]>`
      select model.id, model.external_model_id
      from provider_models model
      where model.capabilities ? 'variant'
    `;
    const modelIdByExternal = new Map(models.map((row) => [row.external_model_id, row.id]));

    const features = await tx<{ id: string; code: string }[]>`select id, code from features`;
    const featureIdByCode = new Map(features.map((row) => [row.code, row.id]));

    const missing = rows.filter((row) => !modelIdByExternal.has(row.externalModelId) || !featureIdByCode.has(row.featureCode));
    if (missing.length) {
      const names = [...new Set(missing.map((row) => `${row.variantId} (${row.externalModelId} / ${row.featureCode})`))];
      throw new Error(`the catalogue has no row for:\n  ${names.join("\n  ")}\nRun pnpm catalog:publish first.`);
    }

    const live = await tx<({ id: string; provider_model_id: string; feature_id: string; selector: Record<string, string> } & Priced)[]>`
      select id, provider_model_id, feature_id, selector, pricing_mode, is_offered,
             provider_units_base, provider_units_per_second, provider_units_per_1k_input_tokens,
             micro_credits_base, micro_credits_per_second, micro_credits_per_1k_input_tokens,
             margin_pct, max_billable_units
      from model_prices where valid_to is null
    `;
    const key = (modelId: string, featureId: string, selector: Record<string, string>) =>
      `${modelId}|${featureId}|${JSON.stringify(Object.fromEntries(Object.entries(selector).sort()))}`;
    const liveByKey = new Map(live.map((row) => [key(row.provider_model_id, row.feature_id, row.selector), row]));

    let opened = 0;
    let superseded = 0;
    const seen = new Set<string>();

    for (const row of rows) {
      const modelId = modelIdByExternal.get(row.externalModelId)!;
      const featureId = featureIdByCode.get(row.featureCode)!;
      const fingerprint = key(modelId, featureId, row.selector);
      seen.add(fingerprint);

      const wanted = intended(row);
      const current = liveByKey.get(fingerprint);
      if (current && same(current, wanted)) continue;

      // Close first, then open. The unique index allows many rows per selector
      // only because they differ by valid_from; two open rows would be two live
      // prices for one thing, and nothing would say which one a quote used.
      if (current) {
        await tx`update model_prices set valid_to = now() where id = ${current.id}`;
        superseded += 1;
      }

      await tx`
        insert into model_prices (
          provider_model_id, feature_id, selector, pricing_mode, is_offered,
          provider_units_base, provider_units_per_second, provider_units_per_1k_input_tokens,
          micro_credits_base, micro_credits_per_second, micro_credits_per_1k_input_tokens,
          margin_pct, max_billable_units
        ) values (
          ${modelId}, ${featureId}, ${tx.json(row.selector)}, ${wanted.pricing_mode}, ${wanted.is_offered},
          ${wanted.provider_units_base}, ${wanted.provider_units_per_second}, ${wanted.provider_units_per_1k_input_tokens},
          ${wanted.micro_credits_base}, ${wanted.micro_credits_per_second}, ${wanted.micro_credits_per_1k_input_tokens},
          ${wanted.margin_pct}, ${wanted.max_billable_units}
        )
      `;
      opened += 1;
    }

    // A price whose selector no longer exists in the catalogue stops applying.
    // Closed rather than deleted: a job priced under it still has to be able to
    // explain its charge.
    const retired = live.filter((row) => !seen.has(key(row.provider_model_id, row.feature_id, row.selector)));
    for (const row of retired) await tx`update model_prices set valid_to = now() where id = ${row.id}`;

    return { opened, superseded, retired: retired.length, total: rows.length };
  });

  if (summary.opened === 0 && summary.retired === 0) {
    console.log(`pricing already current: ${summary.total} live prices, nothing written`);
  } else {
    console.log(
      `published ${summary.total} prices (${summary.opened} opened, ${summary.superseded} superseded, ${summary.retired} retired)`,
    );
  }
} finally {
  await sql.end();
}
