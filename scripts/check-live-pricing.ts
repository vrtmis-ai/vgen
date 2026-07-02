// Sanity check: every catalog variant must resolve a LIVE price from KIE's real
// table for every value of its price-relevant controls (not just defaults).
// Run: npx tsx scripts/check-live-pricing.ts   (node ≥18; uses real network)

import { FAMILIES, variantControls, type Control } from "../src/data/models";
import { LIVE, RATES_FALLBACK, coinsFor } from "../src/data/pricing";
import { startKieRates, findRate } from "../src/lib/kieRates";
import type { InputMap } from "../src/components/controls";

function defaults(controls: Control[]): InputMap {
  const m: InputMap = {};
  for (const c of controls) {
    if (c.kind === "text") m[c.key] = "";
    else if (c.kind === "toggle") m[c.key] = c.def;
    else if (c.kind === "slider") m[c.key] = c.asString ? String(c.def) : c.def;
    else m[c.key] = c.def;
  }
  return m;
}

// keys that actually move the price — vary these one at a time from defaults
const PRICE_KEYS = new Set(["resolution", "quality", "mode", "rendering_speed", "duration", "sound", "generate_audio", "enable_pro"]);

function variations(controls: Control[]): InputMap[] {
  const base = defaults(controls);
  const out: InputMap[] = [base];
  for (const c of controls) {
    if (!PRICE_KEYS.has(c.key)) continue;
    if (c.kind === "segment" || c.kind === "aspect") {
      for (const o of c.options) if (o.value !== base[c.key]) out.push({ ...base, [c.key]: o.value });
    } else if (c.kind === "slider") {
      for (const v of [c.min, c.max]) if (v !== base[c.key]) out.push({ ...base, [c.key]: c.asString ? String(v) : v });
    } else if (c.kind === "toggle") {
      out.push({ ...base, [c.key]: !base[c.key] });
    }
  }
  return out;
}

async function main() {
  startKieRates();
  // wait until the table is loaded (findRate stops returning null for a known row)
  for (let i = 0; i < 60 && findRate("gpt image 2", "text-to-image", "1k") == null; i++) {
    await new Promise((r) => setTimeout(r, 500));
  }
  if (findRate("gpt image 2", "text-to-image", "1k") == null) {
    console.error("FATAL: live table did not load");
    process.exit(1);
  }

  let bad = 0;
  for (const fam of FAMILIES) {
    for (const v of fam.variants) {
      const controls = variantControls(fam, v);
      for (const input of variations(controls)) {
        const live = LIVE[v.id]?.(input);
        const summary = Object.entries(input)
          .filter(([k]) => PRICE_KEYS.has(k))
          .map(([k, val]) => `${k}=${String(val)}`)
          .join(" ");
        if (live == null) {
          bad++;
          const fb = RATES_FALLBACK[v.id]?.(input);
          console.log(`MISS  ${v.id.padEnd(20)} ${summary}  (fallback=${fb ?? "none"})`);
        } else {
          console.log(`ok    ${v.id.padEnd(20)} ${summary}  → ${live}cr = ${coinsFor(live)} coins`);
        }
      }
    }
  }
  console.log(bad === 0 ? "\nALL LIVE ✅" : `\n${bad} setting combos fell back ❌`);
  process.exit(bad === 0 ? 0 : 2);
}

void main();
