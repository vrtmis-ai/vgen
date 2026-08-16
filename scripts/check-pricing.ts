/**
 * Every price the database serves, against every price the app used to charge.
 *
 * This is the check that makes moving the rate table into Postgres safe. The
 * fixture was generated from the rate functions before they were deleted, so a
 * disagreement here means the migration changed what a customer pays — which is
 * the one outcome that is never acceptable, in either direction.
 *
 * It also audits the margin, because a price row that clears less than cost is
 * a job sold at a loss and no amount of matching the old number makes that fine.
 *
 * Run: pnpm check:pricing   (needs DATABASE_URL; no network)
 */
import { config } from "dotenv";
import postgres from "postgres";
// Reached by path rather than by package name. `@vgen/db` is not a dependency
// of the web workspace and adding one for a script would drag the whole backend
// into the browser build's dependency graph to save a relative path.
import { PostgresPricingRepository, PriceUnavailableError } from "../packages/db/src/pricingRepository";
import { COIN_USD, KIE_CREDIT_USD, MARGIN } from "@vgen/core";
import expected from "../src/data/pricing.expected.json" with { type: "json" };
import { eachVariant } from "./pricing/combos";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to check pricing");

interface Entry {
  variant: string;
  input: Record<string, string>;
  chars: number;
  clipSeconds: number;
  coins: number | null;
}

/**
 * Where the billable seconds come from, which the rate table decides per model
 * and a quote will have to decide the same way: the duration control when there
 * is one, otherwise the attached clip. `wan-2-7-videoedit` is the awkward case —
 * duration 0 means "keep the whole source", so it falls through to the clip.
 */
function billableSeconds(input: Record<string, string>, clipSeconds: number): number {
  const duration = Number(input.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : clipSeconds;
}

const sql = postgres(databaseUrl, { max: 4 });

try {
  const pricing = new PostgresPricingRepository(sql);

  const models = await sql<{ id: string; external_model_id: string }[]>`
    select model.id, model.external_model_id
    from provider_models model join providers provider on provider.id = model.provider_id
    where provider.code = 'kie' and model.is_active
  `;
  const modelIdByExternal = new Map(models.map((row) => [row.external_model_id, row.id]));
  const features = await sql<{ id: string; code: string }[]>`select id, code from features`;
  const featureIdByCode = new Map(features.map((row) => [row.code, row.id]));

  const target = new Map(eachVariant().map(({ variant }) => [variant.id, variant]));

  const mismatches: string[] = [];
  let checked = 0;

  for (const entry of (expected as { entries: Entry[] }).entries) {
    const variant = target.get(entry.variant);
    if (!variant) {
      mismatches.push(`${entry.variant}: in the fixture but no longer in the catalogue`);
      continue;
    }
    const providerModelId = modelIdByExternal.get(variant.model);
    const featureId = featureIdByCode.get(variant.featureCode);
    if (!providerModelId || !featureId) {
      mismatches.push(`${entry.variant}: the database has no model or feature row (run pnpm catalog:publish)`);
      continue;
    }

    checked += 1;
    let actual: number | null = null;
    try {
      const price = await pricing.priceFor({
        providerModelId,
        featureId,
        params: entry.input,
        seconds: billableSeconds(entry.input, entry.clipSeconds),
        characters: entry.chars,
      });
      actual = price.coins;
    } catch (error) {
      if (error instanceof PriceUnavailableError && error.code === "not_offered") actual = null;
      else throw error;
    }

    if (actual !== entry.coins) {
      const where = Object.entries(entry.input)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      mismatches.push(
        `${entry.variant.padEnd(22)} ${where} chars=${entry.chars} clip=${entry.clipSeconds}s  expected ${entry.coins} coins, database says ${actual}`,
      );
    }
  }

  // The margin floor. Every offered price must clear what the provider charges,
  // or the catalogue is selling generations below cost.
  const belowCost = await sql<{ variant: string; coins: string; cost: string }[]>`
    select model.external_model_id as variant,
           (price.micro_credits_base + price.micro_credits_per_second + price.micro_credits_per_1k_input_tokens)::text as coins,
           (price.provider_units_base + price.provider_units_per_second + price.provider_units_per_1k_input_tokens)::text as cost
    from model_prices price
    join provider_models model on model.id = price.provider_model_id
    where price.valid_to is null and price.is_offered
  `;
  const thin = belowCost.filter((row) => {
    const chargedUsd = (Number(row.coins) / 1_000_000) * COIN_USD;
    const costUsd = Number(row.cost) * KIE_CREDIT_USD;
    return costUsd > 0 && chargedUsd < costUsd * MARGIN - 1e-9;
  });

  if (mismatches.length === 0 && thin.length === 0) {
    console.log(`${checked} prices checked against the frozen fixture — every one matches ✅`);
    console.log(`${belowCost.length} live price rows, all clearing the ${MARGIN}x margin floor ✅`);
    process.exit(0);
  }

  if (mismatches.length) {
    console.error(`${mismatches.length} of ${checked} prices disagree with the fixture:\n`);
    for (const line of mismatches.slice(0, 40)) console.error(`  ${line}`);
    if (mismatches.length > 40) console.error(`  … and ${mismatches.length - 40} more`);
  }
  if (thin.length) {
    console.error(`\n${thin.length} live prices do not clear the margin floor:`);
    for (const row of thin) console.error(`  ${row.variant} charges ${row.coins} micro-credits against ${row.cost} provider credits`);
  }
  process.exit(2);
} finally {
  await sql.end();
}
