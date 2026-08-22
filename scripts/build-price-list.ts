// Generate the browser's copy of the price list from the full one.
//
//   pnpm exec tsx scripts/build-price-list.ts
//
// `upstream.pricing.json` is what the seeder writes into `model_prices`, and it
// carries two things the browser must never see: `externalModelId`, the
// supplier's own path, and `providerUnits`, what a generation costs us. Sitting
// next to `microCredits` — what we charge — the pair is our margin, published,
// in a JS chunk, to anyone who opens DevTools.
//
// The browser genuinely does not need either. `src/data/pricing.ts` shapes each
// row into a `PriceRowLike` and `resolvePrice` computes `providerUnits` from it,
// but `coinsForVariantId` returns `outcome.coins` and throws the rest away.
// Stripping the fields changes no number on any screen — a claim the reduced
// file's own tests keep honest.
//
// Committed rather than built at install time, for the reason the pricing
// comment already gives: CI builds an empty database every run, so the rows have
// to live in the repository. `check-combos.ts` fails if this file drifts from
// its source.
import { readFileSync, writeFileSync } from "node:fs";
import { PUBLIC_PRICE_FIELDS, reducePriceRows, type FullPriceRow } from "./priceList";

const source = new URL("../src/data/upstream.pricing.json", import.meta.url);
const target = new URL("../src/data/pricing.rows.json", import.meta.url);

const full = JSON.parse(readFileSync(source, "utf8")) as { rows: FullPriceRow[] };
const reduced = reducePriceRows(full.rows);

writeFileSync(target, JSON.stringify({ rows: reduced }, null, 2) + "\n", "utf8");
console.log(`wrote ${reduced.length} rows, keeping ${PUBLIC_PRICE_FIELDS.join(", ")}`);
