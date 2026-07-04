// Live price calculator.
//
// KIE has NO pre-generation price/estimate endpoint (every /estimate|/price|/cost
// path returns 404), but it DOES publish its full per-model rate table (see
// lib/kieRates.ts). Prices are resolved live from that table by matching the
// user's chosen settings to the right row; the built-in RATES below are only a
// fallback for offline / first paint / rows KIE renames. The final source of
// truth stays `creditsConsumed` returned after each task (backend settles it).
//
// Economics (locked):
//   1 KIE credit         = $0.005   (1000 credits = $5)
//   1 Vgen coin (سکه)    = $0.05    (what the user pays per coin)
//   margin               = 2x
//   => coins = ceil(kieCredits * 0.005 * 2 / 0.05) = ceil(kieCredits * 0.2)

import type { Variant } from "./models";
import type { InputMap } from "../components/controls";
import { findRate } from "../lib/kieRates";

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
    return pick(i.resolution, { "720p": sound ? 20 : 14, "1080p": sound ? 27 : 18, "4k": 67 }, 18) * num(i.duration, 5);
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

// ---- live lookup ------------------------------------------------------------
// Per-variant resolvers: settings → tokens that select the right row in KIE's
// live table (all tokens must appear in the row's description; "!x" = must not).
// Descriptions are matched normalized (lowercase, single spaces).

type LiveFn = (i: InputMap) => number | null;

const dur = (i: InputMap, fb: number) => num(i.duration, fb);
/** per-second row × duration (null passes through). */
const perSec = (cr: number | null, s: number) => (cr == null ? null : cr * s);
const res = (i: InputMap, fb: string) => String(i.resolution ?? fb).toLowerCase();

/** Exported for tests (scripts/check-live-pricing.ts) — app code goes through kieCreditsFor. */
export const LIVE: Record<string, LiveFn> = {
  // ---- image (per image / per generation) ----
  "nano-banana-pro": (i) => (res(i, "1K") === "4k" ? findRate("nano banana pro", "4k") : findRate("nano banana pro", "1/2k")),
  "nano-banana-2": (i) => findRate("google nano banana 2", res(i, "1K")),
  "seedream-4-5": () => findRate("seedream 4.5", "text-to-image"),
  "seedream-5-lite": () => findRate("seedream 5.0 lite", "text-to-image"),
  "gpt-image-2": (i) => findRate("gpt image 2", "text-to-image", res(i, "1K")),
  "gpt-image-1-5": (i) => findRate("gpt image 1.5", "text-to-image", String(i.quality ?? "medium")),
  "flux-2-pro": (i) => findRate("flux-2 pro", "text-to-image", res(i, "1K")),
  "flux-2-flex": (i) => findRate("flux 2 flex", "text to image", res(i, "1K")),
  "imagen-4-ultra": () => findRate("google imagen4", "ultra"),
  "imagen-4": () => findRate("google imagen4", "default"),
  "imagen-4-fast": () => findRate("google imagen4", "fast"),
  "ideogram-v3": (i) => findRate("ideogram v3,", "text-to-image", String(i.rendering_speed ?? "BALANCED")),
  "qwen-image": () => findRate("qwen image", "text-to-image", "!edit"), // per megapixel; outputs ≈ 1MP
  "z-image": () => findRate("qwen z-image", "text-to-image"),
  "grok-image": (i) => (Boolean(i.enable_pro) ? findRate("grok-imagine", "text-to-image(quality)") : findRate("grok-imagine,", "text-to-image", "!quality")),

  // ---- video ----
  // Seedance rows are per second, split by resolution; "no video input" = the
  // conservative text-to-video rate (image input is cheaper — settled after).
  "seedance-2": (i) => perSec(findRate("bytedance/seedance-2,", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-2-fast": (i) => perSec(findRate("seedance-2 fast", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-2-mini": (i) => perSec(findRate("seedance-2-mini", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-1-5-pro": (i) => perSec(findRate("seedance-1.5-pro", `${Boolean(i.generate_audio) ? "with" : "without"} audio-${res(i, "720p")}`), dur(i, 5)),
  // Kling 3.0 rows are per second by audio + resolution.
  "kling-3": (i) => {
    const r = String(i.resolution ?? "1080p").toLowerCase();
    return perSec(findRate("kling 3.0, video", `${Boolean(i.sound) ? "with" : "without"} audio-${r}`), dur(i, 5));
  },
  "kling-2-6": (i) => findRate("kling 2.6", "text-to-video", `${Boolean(i.sound) ? "with" : "without"} audio-${dur(i, 5)}.0s`),
  "kling-2-5-turbo": (i) => findRate("kling 2.5 turbo", "text-to-video", `turbo pro-${dur(i, 5)}.0s`),
  "kling-2-1": (i) => findRate("kling 2.1", "video-generation", `pro-${dur(i, 5)}.0s`),
  "wan-2-5": (i) => findRate("wan 2.5", "text-to-video", `default-${dur(i, 5)}.0s-${res(i, "720p")}`),
  "wan-2-6": (i) => findRate("wan 2.6", "text to video", `, ${dur(i, 5)}.0s-${res(i, "1080p")}`), // leading ", " so 5.0s can't match 15.0s
  "wan-2-7": (i) => perSec(findRate("wan 2.7 video", "text-to-video", res(i, "1080p")), dur(i, 5)),
  "hailuo-02-pro": () => findRate("hailuo 02", "text-to-video", "pro-6.0s-1080p"),
  "hailuo-02-standard": (i) => findRate("hailuo 02", "text-to-video", `standard-${dur(i, 6)}.0s-768p`),
  "hailuo-2-3": (i) => findRate("hailuo 2.3", "image-to-video", `pro-${dur(i, 6)}.0s-${res(i, "768P")}`),
  "veo-quality": (i) => findRate("google veo 3.1", "text-to-video", `quality-${res(i, "720p")}`),
  "veo-fast": (i) => findRate("google veo 3.1", "text-to-video", `fast-${res(i, "720p")}`),
  "veo-lite": (i) => findRate("google veo 3.1", "text-to-video", `lite-${res(i, "720p")}`),
  "grok-video": (i) => perSec(findRate("grok-imagine,", "text-to-video", res(i, "480p")), dur(i, 6)),
};

/** KIE credits the current settings will cost: live table first, built-in fallback second. */
export function kieCreditsFor(variant: Variant, input: InputMap): number | null {
  const live = LIVE[variant.id]?.(input);
  if (live != null) return live;
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

/** Exported for tests — the built-in fallback table. */
export { RATES as RATES_FALLBACK };
