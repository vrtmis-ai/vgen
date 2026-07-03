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

export const COIN_USD = 0.05;
export const TOMAN_PER_USD = 170_000; // set 2026-07 by owner ($50 ≈ 8.5M Toman)

export interface CoinPack {
  id: string;
  name: string; // display name (Persian)
  coins: number; // coins purchased
  bonus: number; // extra coins gifted
  priceUsd: number; // normal price (2nd purchase onward)
  firstUsd?: number; // one-time first-purchase price (~20% off)
  annualUsdPerMonth?: number; // per-month rate, billed yearly upfront
  tag?: string; // small label (popular / best value / gift)
  popular?: boolean;
}

export const PACKS: CoinPack[] = [
  { id: "starter", name: "Starter", coins: 30, bonus: 0, priceUsd: 1.5, tag: "برای تست" },
  { id: "basic", name: "Basic", coins: 80, bonus: 0, priceUsd: 4 },
  { id: "flow", name: "Flow", coins: 150, bonus: 0, priceUsd: 7.5 },
  { id: "plus", name: "Plus", coins: 500, bonus: 25, priceUsd: 25, tag: "۵٪ هدیه" },
  { id: "pro", name: "Pro", coins: 1000, bonus: 100, priceUsd: 49, firstUsd: 39, annualUsdPerMonth: 39, tag: "پرطرفدار", popular: true },
  { id: "studio", name: "Studio", coins: 2000, bonus: 200, priceUsd: 99, firstUsd: 80, annualUsdPerMonth: 80 },
  { id: "creator", name: "Creator", coins: 3000, bonus: 450, priceUsd: 139, firstUsd: 119, annualUsdPerMonth: 109, tag: "بهترین ارزش" },
];

/** Toman price for a USD amount (rounded to the nearest 1000). */
export function toman(usd: number): number {
  return Math.round((usd * TOMAN_PER_USD) / 1000) * 1000;
}

/** First-purchase discount percent vs the normal price (0 for single-price packs). */
export function firstDiscountPct(pack: CoinPack): number {
  if (pack.firstUsd == null) return 0;
  return Math.round((1 - pack.firstUsd / pack.priceUsd) * 100);
}
