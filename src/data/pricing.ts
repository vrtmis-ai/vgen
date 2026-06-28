// Live price calculator.
//
// KIE has NO pre-generation price/estimate endpoint (every /estimate|/price|/cost
// path returns 404). The real cost is only knowable from `creditsConsumed` after a
// task finishes, or from KIE's published per-model rates. So we compute the price
// locally and instantly from the user's chosen settings — no network round-trip.
//
// Economics (locked):
//   1 KIE credit         = $0.005   (1000 credits = $5)
//   1 Vgen coin (سکه)    = $0.05    (what the user pays per coin)
//   margin               = 2x
//   => coins = ceil(kieCredits * 0.005 * 2 / 0.05) = ceil(kieCredits * 0.2)

import type { Variant } from "./models";
import type { InputMap } from "../components/controls";

export const KIE_CREDIT_USD = 0.005;
export const COIN_USD = 0.05;
export const MARGIN = 2;

/** Our coin price for a generation that costs `kieCredits` on KIE. */
export function coinsFor(kieCredits: number): number {
  return Math.ceil((kieCredits * KIE_CREDIT_USD * MARGIN) / COIN_USD);
}

type RateFn = (i: InputMap) => number;

function num(v: unknown, fb: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

// Real KIE credit cost per generation (from KIE's published per-model rates).
// image models = per generation (by resolution / speed); video = per second × duration,
// or a fixed per-video tier. Seedance/Kling use the text-to-video ("no input") rate as a
// conservative upper bound.
const RATES: Record<string, RateFn> = {
  "nano-banana-2": (i) => pick(i.resolution, { "1K": 8, "2K": 12, "4K": 18 }, 8),
  "nano-banana-pro": (i) => pick(i.resolution, { "1K": 18, "2K": 18, "4K": 24 }, 18),
  "seedream-4-5": () => 6.5,
  "gpt-image-2": (i) => pick(i.resolution, { "1K": 6, "2K": 10, "4K": 16 }, 6),
  "flux-2-pro": (i) => pick(i.resolution, { "1K": 5, "2K": 7 }, 5),
  "imagen-4-ultra": () => 12,
  "imagen-4": () => 8,
  "imagen-4-fast": () => 4,
  "ideogram-v3": (i) => pick(i.rendering_speed, { TURBO: 3.5, BALANCED: 7, QUALITY: 10 }, 7),
  "qwen-image": () => 4, // 4 credits per megapixel; outputs ≈ 1MP
  "z-image": () => 0.8,

  "seedance-2": (i) => pick(i.resolution, { "480p": 19, "720p": 41, "1080p": 102, "4k": 208 }, 41) * num(i.duration, 5),
  "seedance-2-fast": (i) => pick(i.resolution, { "480p": 15.5, "720p": 33 }, 33) * num(i.duration, 5),
  "seedance-2-mini": (i) => pick(i.resolution, { "480p": 9.5, "720p": 20.5 }, 20.5) * num(i.duration, 5),
  "kling-3": (i) => {
    const sound = Boolean(i.sound);
    return pick(i.mode, { std: sound ? 20 : 14, pro: sound ? 27 : 18, "4K": 67 }, 18) * num(i.duration, 5);
  },
  "wan-2-5": (i) => pick(`${i.resolution}-${i.duration}`, { "720p-5": 60, "720p-10": 120, "1080p-5": 100, "1080p-10": 200 }, 60),
  "hailuo-02-pro": () => 57, // Pro, fixed 6s @ 1080p

  // --- added families / variants ---
  "seedream-5-lite": () => 5.5,
  "gpt-image-1-5": (i) => pick(i.quality, { medium: 4, high: 22 }, 4),
  "flux-2-flex": (i) => pick(i.resolution, { "1K": 14, "2K": 24 }, 14),
  "grok-image": (i) => (Boolean(i.enable_pro) ? 5 : 4),
  "grok-video": (i) => pick(i.resolution, { "480p": 1.6, "720p": 3 }, 3) * num(i.duration, 6),
  "seedance-1-5-pro": (i) => {
    const a = Boolean(i.generate_audio);
    return (
      pick(i.resolution, a ? { "480p": 3.5, "720p": 7, "1080p": 15 } : { "480p": 1.75, "720p": 3.5, "1080p": 7.5 }, a ? 7 : 3.5) *
      num(i.duration, 5)
    );
  },
  "kling-2-6": (i) => pick(`${i.duration}`, Boolean(i.sound) ? { "5": 110, "10": 220 } : { "5": 55, "10": 110 }, 55),
  "kling-2-5-turbo": (i) => pick(`${i.duration}`, { "5": 42, "10": 84 }, 42),
  "kling-2-1": (i) => pick(`${i.duration}`, { "5": 50, "10": 100 }, 50),
  "wan-2-6": (i) =>
    pick(`${i.resolution}-${i.duration}`, { "720p-5": 70, "720p-10": 140, "720p-15": 210, "1080p-5": 104.5, "1080p-10": 209.5, "1080p-15": 315 }, 104.5),
  "wan-2-7": (i) => pick(i.resolution, { "720p": 16, "1080p": 24 }, 24) * num(i.duration, 5),
  "hailuo-02-standard": (i) => pick(`${i.duration}`, { "6": 30, "10": 50 }, 30),
  "hailuo-2-3": (i) => pick(`${i.resolution}-${i.duration}`, { "768P-6": 45, "768P-10": 90, "1080P-6": 80, "1080P-10": 135 }, 45),
  "veo-quality": (i) => pick(i.resolution, { "720p": 250, "1080p": 255, "4k": 380 }, 250),
  "veo-fast": (i) => pick(i.resolution, { "720p": 60, "1080p": 65, "4k": 180 }, 60),
  "veo-lite": (i) => pick(i.resolution, { "720p": 30, "1080p": 35, "4k": 150 }, 30),
};

/** KIE credits the current settings will cost, or null if this model's rate is not loaded yet. */
export function kieCreditsFor(variant: Variant, input: InputMap): number | null {
  const fn = RATES[variant.id];
  return fn ? fn(input) : null;
}

/** Final coin price for the current settings, or null if the rate is not loaded yet. */
export function priceCoins(variant: Variant, input: InputMap): number | null {
  const c = kieCreditsFor(variant, input);
  return c == null ? null : coinsFor(c);
}

/** Small helper for rate tables: look up a setting value in a map with a fallback. */
export function pick(value: unknown, table: Record<string, number>, fallback: number): number {
  return table[String(value)] ?? fallback;
}
