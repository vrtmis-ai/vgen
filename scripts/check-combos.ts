// Cross-product audit: every settings combination the UI lets a user build,
// checked against KIE's real rate table.
//
// check-live-pricing.ts varies one control at a time from the defaults, so it
// only ever sees combinations that differ from default in a single field. That
// misses interdependent options — Hailuo 2.3 offers 1080p and 10s separately
// but has no 1080p-10s row, and the fallback table happily invents a price for
// it. This script walks the full cross product instead.
//
// A MISS means the UI allows a combination KIE has no rate row for. That is
// either a control the model doesn't really support at that setting, or a
// token-matching bug in LIVE — both worth knowing, and the two are told apart
// by hand from the row list.
//
// Run: npx tsx scripts/check-combos.ts   (node >= 18; uses real network)

import { FAMILIES, variantControls, type Control } from "../src/data/models";
import { LIVE, RATES_FALLBACK, coinsForKieCredits } from "../src/data/pricing";
import { MODEL_MIN_TIER, auditPlans } from "../src/data/plans";
import { startKieRates, findRate } from "../src/lib/kieRates";
import type { InputMap, InputValue } from "../src/components/controls";

// keys that select a rate row; varying anything else can't change the price
const PRICE_KEYS = new Set([
  "resolution", "quality", "mode", "rendering_speed", "duration",
  "sound", "generate_audio", "enable_pro",
  // Both of these select a rate and both were missing, so the Topaz tiers and
  // Motion Control's output cap were never in the cross product at all — the
  // run printed one row per Topaz variant and called itself exhaustive.
  "upscale_factor", "character_orientation",
]);

const MAX_SLIDER_STEPS = 20;

function valuesFor(c: Control): InputValue[] {
  if (c.kind === "segment" || c.kind === "aspect") return c.options.map((o) => o.value);
  if (c.kind === "toggle") return [false, true];
  if (c.kind === "slider") {
    const steps = Math.floor((c.max - c.min) / c.step) + 1;
    const raw =
      steps <= MAX_SLIDER_STEPS
        ? Array.from({ length: steps }, (_, k) => c.min + k * c.step)
        : [c.min, c.def, c.max];
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

async function main() {
  startKieRates();
  for (let i = 0; i < 60 && findRate("gpt image 2", "text-to-image", "1k") == null; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (findRate("gpt image 2", "text-to-image", "1k") == null) {
    console.error("FATAL: live table did not load");
    process.exit(1);
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
  // than MIN_PLAN_MARGIN, and the estimate anchors must still have rates. The
  // ladder check used to run as a bare call during module evaluation, so a bad
  // edit threw before React mounted — a blank screen instead of a failed build.
  const planProblems = auditPlans();
  if (planProblems.length) {
    console.error(`${planProblems.length} problems in the plan table:`);
    for (const p of planProblems) console.error(`  ${p}`);
    console.error("Fix them in plans.ts.\n");
  }

  let checked = 0;
  const invented: string[] = []; // no live row, but the fallback still quotes a price
  const blocked: string[] = []; // no live row and no fallback — the UI refuses it

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
        if (LIVE[v.id]?.(input, ctx) != null) continue;
        const fb = RATES_FALLBACK[v.id]?.(input, ctx);
        const line = `${v.id.padEnd(22)} ${describe(input)}`;
        if (fb == null) blocked.push(line);
        else invented.push(`${line}  → quotes ${coinsForKieCredits(fb)} coins (${fb}cr)`);
      }
    }
  }

  console.log(`checked ${checked} combinations across ${FAMILIES.length} families\n`);

  if (blocked.length) {
    console.log(`${blocked.length} combinations correctly refused (no rate anywhere, create button disabled):`);
    for (const b of blocked) console.log("  " + b);
    console.log("");
  }

  if (invented.length === 0 && untiered.length === 0 && planProblems.length === 0) {
    console.log("no combination is quoted a price KIE can't honour ✅");
    console.log("every family has a tier ✅");
    console.log("plan ladder holds and every plan clears the margin floor ✅");
    process.exit(0);
  }
  if (invented.length === 0) process.exit(2); // untiered families / plan problems only
  console.log(`${invented.length} combinations are quoted an INVENTED price — KIE has no such rate:\n`);
  for (const m of invented) console.log("  " + m);
  process.exit(2);
}

void main();
