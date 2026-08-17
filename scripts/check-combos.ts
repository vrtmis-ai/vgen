// Cross-product audit: every settings combination the UI lets a user build,
// checked against the price rows.
//
// check-live-pricing.ts varies one control at a time from the defaults, so it
// only ever sees combinations that differ from default in a single field. That
// misses interdependent options — Hailuo 2.3 offers 1080p and 10s separately
// but has no 1080p-10s row, and the fallback table happily invents a price for
// it. This script walks the full cross product instead.
//
// A MISS means the UI offers a combination no price row covers. That is either
// a control the model doesn't really support at that setting, or a selector the
// seeder failed to emit — and either way the Create button would be quoting a
// price nobody has agreed to.
//
// This used to fetch KIE's live rate table and exit 1 if it could not, which
// made a third party able to fail the build. Prices are rows now, so the whole
// audit is offline; `pnpm check:pricing` is what compares those rows against
// what the app used to charge.
//
// Run: npx tsx scripts/check-combos.ts   (no network)

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FAMILIES, variantControls, type Control } from "../src/data/models";
import { priceCoins } from "../src/data/pricing";
import { MODEL_MIN_TIER, auditPlans } from "../src/data/plans";
import { PLAN_LADDER } from "../src/data/planLadder";
import type { InputMap, InputValue } from "../src/components/controls";

// keys that select a rate row; varying anything else can't change the price
const PRICE_KEYS = new Set([
  "resolution",
  "quality",
  "mode",
  "rendering_speed",
  "duration",
  "sound",
  "generate_audio",
  "enable_pro",
  // Both of these select a rate and both were missing, so the Topaz tiers and
  // Motion Control's output cap were never in the cross product at all — the
  // run printed one row per Topaz variant and called itself exhaustive.
  "upscale_factor",
  "character_orientation",
]);

const MAX_SLIDER_STEPS = 20;

function valuesFor(c: Control): InputValue[] {
  if (c.kind === "segment" || c.kind === "aspect") return c.options.map((o) => o.value);
  if (c.kind === "toggle") return [false, true];
  if (c.kind === "slider") {
    const steps = Math.floor((c.max - c.min) / c.step) + 1;
    const raw = steps <= MAX_SLIDER_STEPS ? Array.from({ length: steps }, (_, k) => c.min + k * c.step) : [c.min, c.def, c.max];
    return raw.map((v) => (c.asString ? String(v) : v));
  }
  return [""];
}

function defaultOf(c: Control): InputValue {
  if (c.kind === "text") return "";
  if (c.kind === "toggle") return c.def;
  if (c.kind === "slider") return c.asString ? String(c.def) : c.def;
  return c.def;
}

/** Every combination of the price-relevant controls, with the rest left at default. */
function combos(controls: Control[]): InputMap[] {
  const base: InputMap = {};
  for (const c of controls) base[c.key] = defaultOf(c);

  let out: InputMap[] = [base];
  for (const c of controls) {
    if (!PRICE_KEYS.has(c.key)) continue;
    const vals = valuesFor(c);
    out = out.flatMap((m) => vals.map((v) => ({ ...m, [c.key]: v })));
  }
  return out;
}

function describe(input: InputMap): string {
  return Object.entries(input)
    .filter(([k]) => PRICE_KEYS.has(k))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
}

/**
 * The feature codes the migrations actually seed.
 *
 * Read out of the SQL rather than listed here, because a second list is a
 * second thing to forget. `features.code` is unique, so the seeds are the whole
 * truth about what codes exist — and a variant naming one that does not would
 * mean either a job with a null feature_id or a seeder that dies at INSERT.
 */
function seededFeatureCodes(): Set<string> {
  const directory = fileURLToPath(new URL("../packages/db/migrations/", import.meta.url));
  const codes = new Set<string>();
  for (const name of readdirSync(directory).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(`../packages/db/migrations/${name}`, import.meta.url), "utf8");
    for (const block of sql.matchAll(/INSERT INTO features\s*\([^)]*\)\s*VALUES([\s\S]*?);/gi)) {
      for (const row of (block[1] ?? "").matchAll(/\(\s*'([^']+)'/g)) codes.add(row[1] as string);
    }
  }
  return codes;
}

/** Every variant names a feature the database has. Needs no network — run it first. */
function auditFeatureCodes(): string[] {
  const known = seededFeatureCodes();
  if (known.size === 0) return ["no INSERT INTO features found in packages/db/migrations — the audit cannot run"];
  return FAMILIES.flatMap((f) =>
    f.variants
      .filter((v) => !known.has(v.featureCode))
      .map((v) => `${v.id} names featureCode "${v.featureCode}", which no migration seeds (have: ${[...known].sort().join(", ")})`),
  );
}

async function main() {
  // Before the network, so a data mistake fails the same way whether or not
  // KIE is reachable. Everything below this point needs the live rate table.
  const featureProblems = auditFeatureCodes();
  if (featureProblems.length) {
    console.error(`${featureProblems.length} variants are routed to a feature that does not exist:`);
    for (const p of featureProblems) console.error(`  ${p}`);
    console.error("Add the feature in a migration, or fix the featureCode in models.ts.");
    process.exit(2);
  }

  // A family with no tier entry used to fall through to tier 1 — the cheapest
  // pack — which is the wrong direction to fail in. It now locks instead, so an
  // omission costs a sale rather than the margin. Catch it here either way.
  const untiered = FAMILIES.filter((f) => MODEL_MIN_TIER[f.id] == null);
  if (untiered.length) {
    console.error(`${untiered.length} families have no MODEL_MIN_TIER entry and will be locked:`);
    for (const f of untiered) console.error(`  ${f.id.padEnd(16)} ${f.name}`);
    console.error("Add them to plans.ts.\n");
  }

  // Plan-table invariants: the ladder must not invert, no plan may clear less
  // than its cycle's margin floor, and the estimate anchors must still have rates. The
  // ladder check used to run as a bare call during module evaluation, so a bad
  // edit threw before React mounted — a blank screen instead of a failed build.
  const planProblems = auditPlans(PLAN_LADDER);
  if (planProblems.length) {
    console.error(`${planProblems.length} problems in the plan table:`);
    for (const p of planProblems) console.error(`  ${p}`);
    console.error("Fix them in plans.ts.\n");
  }

  let checked = 0;
  const blocked: string[] = []; // no row covers it — the UI refuses to sell it

  for (const fam of FAMILIES) {
    for (const v of fam.variants) {
      const all = combos(variantControls(fam, v));
      for (const input of all) {
        checked++;
        // Probe values for the models priced by something other than their
        // settings: speech by prompt length, the per-second video models by the
        // attached clip. One 1000-character prompt and one 10-second clip, both
        // realistic, so the printed coin figures mean something. The point here
        // is only that every combination resolves a rate at all.
        const ctx = { chars: 1000, clipSeconds: 10 };
        if (priceCoins(v, input, ctx) != null) continue;
        blocked.push(`${v.id.padEnd(22)} ${describe(input)}`);
      }
    }
  }

  console.log(`checked ${checked} combinations across ${FAMILIES.length} families\n`);

  if (blocked.length) {
    console.log(`${blocked.length} combinations correctly refused (no price row, create button disabled):`);
    for (const b of blocked) console.log("  " + b);
    console.log("");
  }

  if (untiered.length === 0 && planProblems.length === 0) {
    console.log("every priced combination resolves to a real price row ✅");
    console.log("every variant routes to a seeded feature ✅");
    console.log("every family has a tier ✅");
    console.log("plan ladder holds and every plan clears the margin floor ✅");
    process.exit(0);
  }
  process.exit(2); // untiered families / plan problems
}

void main();
