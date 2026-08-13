import type { InputMap, PriceCtx, RateFn } from "./types";

/* ---------------------------------------------------------------------------
   The rate table, and the coin arithmetic on top of it.

   This lives in @vgen/core rather than in the web app because the SERVER has to
   price a generation. A quote written from a number the browser sent is a quote
   the user can edit; the only trustworthy price is one the API derives itself.
   Both sides now read this one table, so a rate change cannot land on the
   client and miss the ledger.

   Pure on purpose — no fetch, no DOM, no catalogue import. The web app layers
   KIE's live table over this at runtime (src/data/pricing.ts); the API uses it
   as-is, which is the conservative direction: the built-in figures are the
   published list prices, and KIE's live table only ever discounts them.

   Economics (locked):
     1 coin = $0.05 to the user · margin 2x · KIE credit = $0.005
   --------------------------------------------------------------------------- */

export const KIE_CREDIT_USD = 0.005;
export const COIN_USD = 0.05;
export const MARGIN = 2;

/** Coins we charge for a generation that costs us `costUsd` at the provider. */
export function coinsFor(costUsd: number): number {
  return Math.ceil((costUsd * MARGIN) / COIN_USD);
}

/** Same, for a provider that quotes in KIE credits. */
export function coinsForKieCredits(credits: number): number {
  return coinsFor(credits * KIE_CREDIT_USD);
}

export const NO_CTX: PriceCtx = { chars: 0, clipSeconds: 0 };

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

  // Read off KIE's live table on 2026-08-11, "no video" column — the same
  // conservative upper bound the rest of the video block uses, since supplying
  // a reference clip switches KIE to a cheaper rate and we do not re-quote.
  "seedance-2-5": (i) => pick(i.resolution, { "480p": 28, "720p": 63 }, 63) * num(i.duration, 5),
  "seedance-2": (i) => pick(i.resolution, { "480p": 19, "720p": 41, "1080p": 102, "4k": 208 }, 41) * num(i.duration, 5),
  "seedance-2-fast": (i) => pick(i.resolution, { "480p": 15.5, "720p": 33 }, 33) * num(i.duration, 5),
  "seedance-2-mini": (i) => pick(i.resolution, { "480p": 3.8, "720p": 8.2 }, 8.2) * num(i.duration, 5),
  // 768p and 2K only; KIE does not price H3's 4K tier, so the catalog does not
  // offer it. Text, image and reference all bill at the same per-second rate.
  "minimax-h3": (i) => pick(i.resolution, { "768p": 16, "2k": 26 }, 26) * num(i.duration, 5),
  "kling-3": (i) => {
    const sound = Boolean(i.sound);
    // keyed by Kling 3.0's `mode`, not a resolution string
    return pick(i.mode, { std: sound ? 20 : 14, pro: sound ? 27 : 18, "4K": 67 }, 18) * num(i.duration, 5);
  },
  "wan-2-5": (i) => pick(`${i.resolution}-${i.duration}`, { "720p-5": 60, "720p-10": 120, "1080p-5": 100, "1080p-10": 200 }, 60),

  // --- added families / variants ---
  "seedream-5-lite": () => 5.5,
  "gpt-image-1-5": (i) => pick(i.quality, { medium: 4, high: 22 }, 4),
  "flux-2-flex": (i) => pick(i.resolution, { "1K": 14, "2K": 24 }, 14),
  "grok-image": (i) => (i.enable_pro ? 5 : 4),
  "seedance-1-5-pro": (i) => {
    const a = Boolean(i.generate_audio);
    return (
      pick(i.resolution, a ? { "480p": 3.5, "720p": 7, "1080p": 15 } : { "480p": 1.75, "720p": 3.5, "1080p": 7.5 }, a ? 7 : 3.5) *
      num(i.duration, 5)
    );
  },
  "kling-3-turbo": (i) => pick(i.resolution, { "720p": 18, "1080p": 22.5 }, 18) * num(i.duration, 5),
  "kling-2-6": (i) => pick(`${i.duration}`, i.sound ? { "5": 110, "10": 220 } : { "5": 55, "10": 110 }, 55),
  "kling-2-5-turbo": (i) => pick(`${i.duration}`, { "5": 42, "10": 84 }, 42),
  "wan-2-6": (i) =>
    pick(
      `${i.resolution}-${i.duration}`,
      { "720p-5": 70, "720p-10": 140, "720p-15": 210, "1080p-5": 104.5, "1080p-10": 209.5, "1080p-15": 315 },
      104.5,
    ),
  "wan-2-7": (i) => pick(i.resolution, { "720p": 16, "1080p": 24 }, 24) * num(i.duration, 5),
  "wan-2-7-r2v": (i) => pick(i.resolution, { "720p": 16, "1080p": 24 }, 24) * num(i.duration, 5),
  // Billed per second of output. duration 0 means "keep the whole source clip",
  // so the length then comes from the uploaded file and isn't known until it lands.
  "wan-2-7-videoedit": (i, c) => {
    const billed = num(i.duration, 0) || c.clipSeconds;
    return billed > 0 ? pick(i.resolution, { "720p": 16, "1080p": 24 }, 16) * billed : null;
  },
  // KIE: "10 seconds videos are not supported for 1080p resolution" — the missing
  // key returns null rather than a made-up price for a job that can't be created.
  "hailuo-2-3": (i) => only(`${i.resolution}-${i.duration}`, { "768P-6": 45, "768P-10": 90, "1080P-6": 80 }),
  "hailuo-2-3-standard": (i) => only(`${i.resolution}-${i.duration}`, { "768P-6": 30, "768P-10": 50, "1080P-6": 50 }),
  // Flat per-video by duration; 720p and 1080p are billed identically.
  "gemini-omni-video": (i) =>
    only(`${i.resolution}-${i.duration}`, {
      "720p-4": 63,
      "1080p-4": 63,
      "4k-4": 147,
      "720p-6": 84,
      "1080p-6": 84,
      "4k-6": 168,
      "720p-8": 105,
      "1080p-8": 105,
      "4k-8": 189,
      "720p-10": 126,
      "1080p-10": 126,
      "4k-10": 210,
    }),
  // Motion Control bills per second — there is no duration setting, the length
  // comes from the clip the user attaches. With no clip there is nothing to
  // price, so the create button stays shut rather than quoting a number that
  // would change once a file lands.
  "kling-3-motion": (i, c) => {
    const s = motionSeconds(i, c.clipSeconds);
    return s > 0 ? pick(i.mode, { "720p": 20, "1080p": 27 }, 20) * s : null;
  },
  "kling-2-6-motion": (i, c) => {
    const s = motionSeconds(i, c.clipSeconds);
    return s > 0 ? pick(i.mode, { "720p": 11, "1080p": 18 }, 11) * s : null;
  },
  // Tools — flat per image. No 1x row exists, so `only` refuses that factor.
  "topaz-image-upscale": (i) => only(`${i.upscale_factor}`, { "2": 10, "4": 20, "8": 40 }),
  "recraft-crisp-upscale": () => 0.5,
  "recraft-remove-bg": () => 1,
  // Per second of the source clip. 1x and 2x share one rate row.
  "topaz-video-upscale": (i, c) => (c.clipSeconds > 0 ? pick(`${i.upscale_factor}`, { "1": 8, "2": 8, "4": 14 }, 8) * c.clipSeconds : null),
  // Text-to-speech: settings don't move the price, the text's length does.
  "eleven-turbo": (_i, c) => perKChars(6, c.chars),
  "eleven-multilingual": (_i, c) => perKChars(12, c.chars),
  "veo-quality": (i) => pick(i.resolution, { "720p": 250, "1080p": 255, "4k": 380 }, 250),
  "veo-fast": (i) => pick(i.resolution, { "720p": 60, "1080p": 65, "4k": 180 }, 60),
  "veo-lite": (i) => pick(i.resolution, { "720p": 30, "1080p": 35, "4k": 150 }, 30),
};

export function pick(value: unknown, table: Record<string, number>, fallback: number): number {
  return table[String(value)] ?? fallback;
}

/** Like `pick`, but a missing key means "not offered" rather than "use the default". */
function only(value: unknown, table: Record<string, number>): number | null {
  return table[String(value)] ?? null;
}

/** Speech models bill per 1000 characters, rounded up, minimum one block. */
export const perKChars = (rate: number | null, chars: number) => (rate == null ? null : rate * Math.max(1, Math.ceil(chars / 1000)));

/** Exported for tests — the built-in fallback table. */
export { RATES as RATES_FALLBACK };
