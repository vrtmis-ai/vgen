// Coin (سکه) packages for the buy screen.
//
// Economics: 1 coin = $0.05 of value (5 KIE credits). Iranian users pay Toman
// via ZarinPal. TOMAN_PER_USD is THE one constant to update when the exchange
// rate moves — every displayed price derives from it.
//
// Big packs are three-tier (set with owner, 2026-07):
//   first   ≈ 20% off the normal price — once per Telegram user
//   normal  = 2nd purchase onward
//   annual  = first-purchase rate billed monthly, 12 months paid upfront
// Test/small packs are single-price at full margin (they ARE the entry offer).
// NOTE: enforcing "first purchase" needs the backend (per-user history);
// until then the UI shows the offer and the backend phase wires it up.

import { coinsFor, RATES_FALLBACK } from "./pricing";
import { FAMILIES } from "./models";

export const COIN_USD = 0.05;
export const TOMAN_PER_USD = 170_000; // set 2026-07 by owner ($50 ≈ 8.5M Toman)

/** Access tier a pack grants. Models declare the minimum tier that unlocks them. */
export type Tier = 1 | 2 | 3;

export interface CoinPack {
  id: string;
  name: string; // display name (latin, language-neutral)
  coins: number; // coins purchased
  bonus: number; // extra coins gifted
  tier: Tier; // model-access tier this pack unlocks
  priceUsd: number; // normal price (2nd purchase onward)
  firstUsd?: number; // one-time first-purchase price (~20% off)
  annualUsdPerMonth?: number; // per-month rate, billed yearly upfront
  tag?: "test" | "gift" | "popular" | "best"; // label key, translated in UI
  popular?: boolean;
}

export const PACKS: CoinPack[] = [
  { id: "starter", name: "Starter", coins: 30, bonus: 0, tier: 1, priceUsd: 1.5, tag: "test" },
  { id: "basic", name: "Basic", coins: 80, bonus: 0, tier: 1, priceUsd: 4 },
  { id: "flow", name: "Flow", coins: 150, bonus: 0, tier: 1, priceUsd: 7.5 },
  { id: "plus", name: "Plus", coins: 500, bonus: 25, tier: 1, priceUsd: 25, tag: "gift" },
  { id: "pro", name: "Pro", coins: 1000, bonus: 100, tier: 2, priceUsd: 49, firstUsd: 39, annualUsdPerMonth: 39, tag: "popular", popular: true },
  { id: "studio", name: "Studio", coins: 2000, bonus: 200, tier: 3, priceUsd: 99, firstUsd: 80, annualUsdPerMonth: 80 },
  { id: "creator", name: "Creator", coins: 3000, bonus: 450, tier: 3, priceUsd: 139, firstUsd: 119, annualUsdPerMonth: 109, tag: "best" },
];

/* ---- model access gating (owner-tunable, single source of truth) ----------
   tier 1 — everyday/economy models, every pack unlocks these
   tier 2 — pro creator models (Pro and up)
   tier 3 — flagship models (Studio / Creator only)
   NOTE: real enforcement happens in the backend phase; the UI reads this map
   to communicate access on plan cards (and later to lock model pages). */
export const MODEL_MIN_TIER: Record<string, Tier> = {
  "z-image": 1,
  qwen: 1,
  "grok-image": 1,
  "grok-video": 1,
  seedream: 1,
  "gpt-image": 1,
  wan: 1,
  hailuo: 1,
  "nano-banana": 2,
  flux: 2,
  imagen: 2,
  ideogram: 2,
  seedance: 2,
  kling: 2,
  veo: 3,
};

/** Family display names newly unlocked AT this tier (not cumulative). */
export function tierUnlockNames(tier: Tier): string[] {
  return FAMILIES.filter((f) => (MODEL_MIN_TIER[f.id] ?? 1) === tier)
    .map((f) => f.name)
    .filter((v, i, a) => a.indexOf(v) === i);
}

/* ---- "what can I make with this?" — derived from the real rate table ------
   anchors: a popular image (GPT Image 1K) and a popular video (Kling pro 5s).
   Derived, not hardcoded: repricing models updates every plan card. */
export const COST_PER_IMAGE = coinsFor(RATES_FALLBACK["gpt-image-2"]!({ resolution: "1K" }));
export const COST_PER_VIDEO5S = coinsFor(RATES_FALLBACK["kling-3"]!({ mode: "pro", duration: 5, sound: false }));

export function estImages(pack: CoinPack): number {
  return Math.floor((pack.coins + pack.bonus) / COST_PER_IMAGE);
}
export function estVideos(pack: CoinPack): number {
  return Math.floor((pack.coins + pack.bonus) / COST_PER_VIDEO5S);
}

/** Toman price for a USD amount (rounded to the nearest 1000). */
export function toman(usd: number): number {
  return Math.round((usd * TOMAN_PER_USD) / 1000) * 1000;
}

/** First-purchase discount percent vs the normal price (0 for single-price packs). */
export function firstDiscountPct(pack: CoinPack): number {
  if (pack.firstUsd == null) return 0;
  return Math.round((1 - pack.firstUsd / pack.priceUsd) * 100);
}
