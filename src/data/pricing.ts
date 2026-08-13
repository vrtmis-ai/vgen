// Live price calculator.
//
// KIE has NO pre-generation price/estimate endpoint (every /estimate|/price|/cost
// path returns 404), but it DOES publish its full per-model rate table (see
// lib/kieRates.ts). Prices are resolved live from that table by matching the
// user's chosen settings to the right row; the built-in RATES below are only a
// fallback for offline / first paint / rows KIE renames. The final source of
// truth stays `creditsConsumed` from recordInfo — confirmed in the unified
// Get Task Details spec, "the actual number of credits deducted during task
// execution". The per-model pages show an abbreviated response that omits it,
// which is why it looks absent if you only read those.
//
// Economics (locked):
//   1 Vgen coin (سکه)    = $0.05    (what the user pays per coin)
//   margin               = 2x
//   => coins = ceil(costUsd * 2 / 0.05)
//
// The pivot is USD, not provider credits. Each provider prices in its own unit
// (KIE bills credits at $0.005 each) and converts to USD before the coin formula
// sees it, so adding a second provider doesn't touch the coin economy.

import { defaultInput, variantControls, type Family, type Variant } from "./models";
import type { InputMap } from "../components/controls";
import { findRate } from "../lib/kieRates";

/* The rate table and coin arithmetic now live in @vgen/core, because the API
   has to price a generation too and a quote derived from a number the browser
   sent is a quote the user can edit. Re-exported here so every existing
   importer of data/pricing keeps working and there stays exactly one table. */
export { KIE_CREDIT_USD, COIN_USD, MARGIN, coinsFor, coinsForKieCredits, pick, RATES_FALLBACK } from "@vgen/core";
export type { PriceCtx } from "@vgen/core";
import { KIE_CREDIT_USD, NO_CTX, RATES_FALLBACK as RATES, coinsFor, perKChars } from "@vgen/core";
import type { PriceCtx } from "@vgen/core";

function num(v: unknown, fb: number): number {
  // Number("") and Number(false) are both 0, so a bare isFinite check turns an
  // empty or boolean setting into a real zero — and a zero on a per-second model
  // is a job sold for nothing. Only actual numbers and numeric strings count.
  if (typeof v === "number") return Number.isFinite(v) ? v : fb;
  if (typeof v !== "string" || v.trim() === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/**
 * Seconds Motion Control will actually render. `character_orientation` caps the
 * output — 10s when the character comes from the image, 30s when it comes from
 * the video — so anything past the cap is uploaded, paid for and discarded.
 *
 * ⚠️ ASSUMPTION: that KIE bills the seconds it *produces*, not the seconds we
 * hand it. Its rate row says only "per second" and never which. Billing the full
 * upload quotes 162 coins for a job that returns ten seconds, which is the worse
 * error to make in front of a paying user, and the ledger reconciles against
 * `creditsConsumed` either way. Settle it with one real job — HANDOFF §11 item 4.
 */
function motionSeconds(i: InputMap, clipSeconds: number): number {
  const cap = String(i.character_orientation ?? "video") === "image" ? 10 : 30;
  return Math.min(clipSeconds, cap);
}

// Real KIE credit cost per generation (from KIE's published per-model rates).
// image models = per generation (by resolution / speed); video = per second × duration,
// or a fixed per-video tier. Seedance/Kling use the text-to-video ("no input") rate as a
// conservative upper bound.

// ---- live lookup ------------------------------------------------------------
// Per-variant resolvers: settings → tokens that select the right row in KIE's
// live table (all tokens must appear in the row's description; "!x" = must not).
// Descriptions are matched normalized (lowercase, single spaces).

type LiveFn = (i: InputMap, c: PriceCtx) => number | null;

const dur = (i: InputMap, fb: number) => num(i.duration, fb);
/** per-second row × duration (null passes through). */
const perSec = (cr: number | null, s: number) => (cr == null ? null : cr * s);
const res = (i: InputMap, fb: string) => String(i.resolution ?? fb).toLowerCase();

/** Kling 3.0's `mode` values, mapped to the resolution tier its rate rows use. */
const KLING3_MODE_RES: Record<string, string> = { std: "720p", pro: "1080p", "4K": "4k" };

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
  "grok-image": (i) =>
    i.enable_pro ? findRate("grok-imagine", "text-to-image(quality)") : findRate("grok-imagine,", "text-to-image", "!quality"),

  // ---- video ----
  // Seedance rows are per second, split by resolution; "no video input" = the
  // conservative text-to-video rate (image input is cheaper — settled after).
  // "seedance-2-5", not "seedance-2.5": KIE's descriptions hyphenate the minor
  // version. Matching on the dotted form finds nothing and silently falls back.
  "seedance-2-5": (i) => perSec(findRate("bytedance/seedance-2-5,", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-2": (i) => perSec(findRate("bytedance/seedance-2,", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-2-fast": (i) => perSec(findRate("seedance-2 fast", `${res(i, "720p")} no video`), dur(i, 5)),
  "seedance-2-mini": (i) => perSec(findRate("seedance-2-mini,", `${res(i, "720p")} no video`), dur(i, 5)),
  "minimax-h3": (i) => perSec(findRate("minimax h3,", "text to video", res(i, "2k")), dur(i, 5)),
  "seedance-1-5-pro": (i) =>
    perSec(findRate("seedance-1.5-pro", `${i.generate_audio ? "with" : "without"} audio-${res(i, "720p")}`), dur(i, 5)),
  // Rows are per second by audio + resolution, but the model's own parameter is
  // `mode`. std/pro aren't spelled out as 720p/1080p anywhere in the docs — the
  // mapping comes from "std has standard resolution, pro has higher resolution"
  // lining up with the rate table's three tiers. Worth re-checking against a
  // real job's creditsConsumed.
  "kling-3": (i) => {
    const r = KLING3_MODE_RES[String(i.mode ?? "pro")] ?? "1080p";
    return perSec(findRate("kling 3.0, video", `${i.sound ? "with" : "without"} audio-${r}`), dur(i, 5));
  },
  // Per second by resolution, no audio tier. The text-to-video and image-to-video
  // rows carry the same rate, so matching either one prices both entry points.
  "kling-3-turbo": (i) => perSec(findRate("kling 3.0 turbo", "text-to-video", res(i, "720p")), dur(i, 5)),
  "kling-2-6": (i) => findRate("kling 2.6", "text-to-video", `${i.sound ? "with" : "without"} audio-${dur(i, 5)}.0s`),
  "kling-2-5-turbo": (i) => findRate("kling 2.5 turbo", "text-to-video", `turbo pro-${dur(i, 5)}.0s`),
  "wan-2-5": (i) => findRate("wan 2.5", "text-to-video", `default-${dur(i, 5)}.0s-${res(i, "720p")}`),
  "wan-2-6": (i) => findRate("wan 2.6", "text to video", `, ${dur(i, 5)}.0s-${res(i, "1080p")}`), // leading ", " so 5.0s can't match 15.0s
  "wan-2-7": (i) => perSec(findRate("wan 2.7 video", "text-to-video", res(i, "1080p")), dur(i, 5)),
  "wan-2-7-r2v": (i) => perSec(findRate("wan 2.7 video", "r2v", res(i, "1080p")), dur(i, 5)),
  "wan-2-7-videoedit": (i, c) => {
    const billed = num(i.duration, 0) || c.clipSeconds;
    return billed > 0 ? perSec(findRate("wan 2.7 video", "videoedit", res(i, "720p")), billed) : null;
  },
  "hailuo-2-3": (i) => findRate("hailuo 2.3", "image-to-video", `pro-${dur(i, 6)}.0s-${res(i, "768P")}`),
  "hailuo-2-3-standard": (i) => findRate("hailuo 2.3", "image-to-video", `standard-${dur(i, 6)}.0s-${res(i, "768P")}`),
  // Row text is "gemini-omni-video, video, 8s 1080p no video input" — matched as
  // one contiguous token so a duration can't pair with the wrong resolution.
  "gemini-omni-video": (i) => findRate("gemini-omni-video", `${dur(i, 8)}s ${res(i, "1080p")} no video input`),
  "kling-3-motion": (i, c) => {
    const s = motionSeconds(i, c.clipSeconds);
    return s > 0 ? perSec(findRate("kling 3.0 motion control", "video-to-video", String(i.mode ?? "720p")), s) : null;
  },
  "kling-2-6-motion": (i, c) => {
    const s = motionSeconds(i, c.clipSeconds);
    return s > 0 ? perSec(findRate("kling 2.6 motion control", String(i.mode ?? "720p")), s) : null;
  },
  // Row text is "Topaz Image Upscaler, image-upscale, 2K" — the tier, not the factor.
  "topaz-image-upscale": (i) => findRate("topaz image upscaler", "image-upscale", `${i.upscale_factor}k`),
  "recraft-crisp-upscale": () => findRate("recraft crisp upscale", "image to image"),
  "recraft-remove-bg": () => findRate("recraft remove background", "image to image"),
  // Rows read "upscale factor 1x/2x" and "upscale factor 4x".
  "topaz-video-upscale": (i, c) =>
    c.clipSeconds > 0 ? perSec(findRate("topaz video upscaler", String(i.upscale_factor) === "4" ? "4x" : "1x/2x"), c.clipSeconds) : null,
  "eleven-turbo": (_i, c) => perKChars(findRate("elevenlabs text to speech", "turbo 2.5"), c.chars),
  "eleven-multilingual": (_i, c) => perKChars(findRate("elevenlabs text to speech", "multilingual v2"), c.chars),
  "veo-quality": (i) => findRate("google veo 3.1", "text-to-video", `quality-${res(i, "720p")}`),
  "veo-fast": (i) => findRate("google veo 3.1", "text-to-video", `fast-${res(i, "720p")}`),
  "veo-lite": (i) => findRate("google veo 3.1", "text-to-video", `lite-${res(i, "720p")}`),
};

// ---- KIE provider adapter ---------------------------------------------------

/** KIE credits the current settings will cost: live table first, built-in fallback second. */
export function kieCreditsFor(variant: Variant, input: InputMap, ctx: PriceCtx = NO_CTX): number | null {
  const live = LIVE[variant.id]?.(input, ctx);
  if (live != null) return live;
  const fn = RATES[variant.id];
  return fn ? fn(input, ctx) : null;
}

// ---- provider-neutral -------------------------------------------------------

/**
 * What these settings cost us at the provider, in USD.
 * KIE is the only provider today; a second one adds a branch here, not a rewrite.
 */
export function costUsdFor(variant: Variant, input: InputMap, ctx: PriceCtx = NO_CTX): number | null {
  const credits = kieCreditsFor(variant, input, ctx);
  return credits == null ? null : credits * KIE_CREDIT_USD;
}

/**
 * Final coin price for the current settings, or null if this combination isn't
 * offered — which callers render as "not supported" and use to shut the create
 * button.
 *
 * A non-finite result is treated as no price at all. Callers gate on
 * `price != null`, and `NaN != null` is true, so a NaN leaking out of a corrupt
 * rate row would otherwise arrive as an enabled button with `NaN` on it.
 */
export function priceCoins(variant: Variant, input: InputMap, ctx: PriceCtx = NO_CTX): number | null {
  const usd = costUsdFor(variant, input, ctx);
  if (usd == null || !Number.isFinite(usd)) return null;
  return coinsFor(usd);
}

/**
 * Cheapest this family can be run for, at each variant's own defaults.
 *
 * Home shows it where the mockup had a star rating: we have no ratings, and a
 * fabricated one sits on a purchase decision. Null means every variant needs
 * something we cannot know yet — Motion Control cannot be priced until a clip
 * is attached — and the card says so rather than guessing.
 */
export function minCoinsForFamily(family: Family): number | null {
  let best: number | null = null;
  for (const v of family.variants) {
    const p = priceCoins(v, defaultInput(variantControls(family, v)), NO_CTX);
    if (p != null && (best == null || p < best)) best = p;
  }
  return best;
}
