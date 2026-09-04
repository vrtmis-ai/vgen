// Real KIE model catalog, grouped into families.
// A family (e.g. "Seedance") groups several real KIE models ("variants", e.g. v2 / fast / mini).
// Every `model` id and every control is grounded in docs.kie.ai + the live pricing table.
// See web/KIE_MODELS.md.

export type ModelKind = "image" | "video" | "audio";

export interface AspectOption {
  value: string;
  label: string;
  w: number;
  h: number;
}

export type Control =
  | { kind: "aspect"; key: string; label: string; options: AspectOption[]; def: string }
  | {
      kind: "segment";
      key: string;
      label: string;
      options: { value: string; label: string }[];
      def: string;
      advanced?: boolean;
    }
  | {
      kind: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      def: number;
      unit?: string;
      asString?: boolean;
      advanced?: boolean;
    }
  | { kind: "toggle"; key: string; label: string; def: boolean; advanced?: boolean }
  | { kind: "text"; key: string; label: string; placeholder?: string; advanced?: boolean }
  /**
   * Voice chooser. Its own kind rather than a segment because there are dozens
   * of them and picking by name alone is guesswork — the list needs to be
   * scrollable and each row needs to play a sample.
   */
  | { kind: "voice"; key: string; label: string; def: string; advanced?: boolean };

/** What a slot accepts. Absent means image, which is what most slots take. */
export type SlotMedia = "image" | "video" | "audio";

export interface RefSlot {
  /** `frame` is a position in the clip; `reference` is material to draw from.
   *  Absent means reference. See the contract for why they are separate. */
  group?: "reference" | "frame";
  key: string;
  label: string;
  max: number;
  /** Image unless stated. Drives the file picker's filter and the preview. */
  media?: SlotMedia;
  /**
   * Per-file ceiling in MB, from each model's own docs — they differ a lot
   * (30MB for a Wan clip, 100MB for a Motion Control video).
   *
   * We enforce this ourselves because KIE won't: the only size figure in its
   * upload docs is a *recommended* 100MB on one endpoint, the stream endpoint
   * publishes no cap at all, and no upload endpoint defines a 413. An
   * over-sized file would be accepted here and fail later, after the charge.
   */
  maxMb?: number;
  /**
   * The provider rejects the job without this input (KIE marks the field
   * Required). Gates the create button — otherwise the user pays for a task
   * that fails validation.
   */
  required?: boolean;
  /**
   * Key of a slot this one depends on: filling this while that one is empty is
   * invalid. Kling 2.5 Turbo's tail_image_url is meaningless without image_url —
   * there is no end frame without a start frame.
   */
  requires?: string;
}

/**
 * One concrete model inside a family.
 *
 * **No upstream endpoint here.** Which supplier runs a variant, and under what
 * id, lives in `upstream.json`, which the browser cannot import. This array is
 * bundled for `FAMILIES`, so anything on it is published: the endpoint strings
 * that used to sit on this interface shipped to every visitor and named our
 * supplier in a JS chunk. Nothing in the browser read them.
 */
export interface Variant {
  id: string; // our id (also the pricing key), and the key into upstream.json
  /**
   * Which section of the product this variant serves — a `features.code` row in
   * the database, and what a job is filed under.
   *
   * Stated per variant rather than derived from the family, because the two
   * disagree often enough that inferring it would be wrong: `topaz` is an image
   * family whose second variant upscales video, and `hailuo` cannot be reached
   * without an image while its neighbours in `kling` can. `check-combos.ts`
   * fails the build if this names a feature the database has no row for.
   */
  featureCode: string;
  /** Prompt character limit, when it differs from the family's. */
  maxPrompt?: number;
  /**
   * The flat-fee pipe, for the variants that have one.
   *
   * Same model, served two ways: metered bills per image and is quick, this one
   * bills nothing per image and drops into a slower queue past a daily cap.
   * `scripts/publish-unlimited.ts` seeds the plumbing; this is the half a
   * browser is told, so it can offer the choice before asking for a price.
   *
   * `limits` names the settings it covers. Nano Banana runs unlimited to 2K and
   * not at 4K, and the screen has to be able to say so before the switch is
   * flipped rather than after a quote comes back metered.
   *
   * `minTier` is the lowest plan tier the grant is open to, and it is not the
   * same number as the family's own `minTier`: Nano Banana opens at tier 2 and
   * its grant at tier 3, so a Pro customer can reach the model and not the free
   * pipe. Without it a switch labelled free renders for somebody who will be
   * charged the metered price, which is the one failure a price control must
   * not have. `dailyCap` is nullable because a grant may be genuinely uncapped.
   *
   * The shape mirrors `UnlimitedPipeSchema`, and the values come from
   * `unlimited_entitlements` — never from a hand-written guess here. This
   * literal exists so demo mode and the committed snapshot have something to
   * agree with; `catalogSnapshot.test.ts` is what holds them together.
   */
  unlimited?: { dailyCap: number | null; minTier: 1 | 2 | 3; limits?: Record<string, string[]> };
  label: string; // short version label for the switcher
  badge?: string;
  refs?: RefSlot[] | null; // null = no input slots; undefined = inherit family.refs
  controls?: Control[]; // undefined = inherit family.controls
}

export interface Family {
  id: string;
  name: string;
  vendor: string;
  kind: ModelKind;
  /**
   * Lowest plan tier that may run this family. Compared against `plans.tier`.
   *
   * Stated per family and never defaulted: an unlisted family used to fall
   * through to tier 1 — the cheapest pack — so four families added later were
   * silently available on it, one of them costing up to 210 provider credits a
   * video. A missing tier must cost a sale, never the margin, and
   * `check-combos.ts` fails the build if one is absent.
   */
  minTier: 1 | 2 | 3;
  blurb: string;
  badge?: string;
  grad: string;
  cover?: string; // real preview image URL (fills in later; falls back to grad)
  refs?: RefSlot[];
  /**
   * Prompt character limit the provider enforces. These vary by 25x across the
   * catalog — 800 on Wan 2.5, 20000 on Seedance — and going over is a 422, so
   * the user pays for a job that dies on submit.
   */
  maxPrompt?: number;
  /**
   * The model takes no prompt at all — it transforms an uploaded file. Upscalers
   * and background removal work this way. Generate hides the prompt box and stops
   * requiring one, which would otherwise keep the create button disabled forever.
   */
  noPrompt?: boolean;
  controls: Control[];
  variants: Variant[];
}

// ---- shared aspect-ratio option sets ----------------------------------------

const A = (value: string, label: string, w: number, h: number): AspectOption => ({ value, label, w, h });

const ratios = {
  sq: A("1:1", "1:1", 1, 1),
  p23: A("2:3", "2:3", 2, 3),
  p34: A("3:4", "3:4", 3, 4),
  p45: A("4:5", "4:5", 4, 5),
  p916: A("9:16", "9:16", 9, 16),
  l32: A("3:2", "3:2", 3, 2),
  l43: A("4:3", "4:3", 4, 3),
  l54: A("5:4", "5:4", 5, 4),
  l169: A("16:9", "16:9", 16, 9),
  l219: A("21:9", "21:9", 21, 9),
  auto: A("auto", "خودکار", 1, 1),
  adaptive: A("adaptive", "تطبیقی", 1, 1),
};

const sizes = {
  square_hd: A("square_hd", "1:1", 1, 1),
  p43: A("portrait_4_3", "3:4", 3, 4),
  p169: A("portrait_16_9", "9:16", 9, 16),
  l43: A("landscape_4_3", "4:3", 4, 3),
  l169: A("landscape_16_9", "16:9", 16, 9),
};

const QUALITY = (def: string, vals: string[]): Control => ({
  kind: "segment",
  key: "resolution",
  label: "کیفیت",
  def,
  options: vals.map((v) => ({ value: v, label: v === "4k" ? "4K" : v })),
});

// Seedance variants share one schema; only the available resolutions differ (from the price table).
function seedanceControls(res: string[]): Control[] {
  return [
    {
      kind: "aspect",
      key: "aspect_ratio",
      label: "نسبت تصویر",
      def: "16:9",
      // "adaptive" is not one of the API's aspect_ratio options — it would 422.
      options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219],
    },
    QUALITY(res.includes("720p") ? "720p" : (res[0] ?? "720p"), res),
    { kind: "slider", key: "duration", label: "مدت", min: 4, max: 15, step: 1, def: 5, unit: "ثانیه" },
    { kind: "toggle", key: "generate_audio", label: "تولید صدا", def: true },
  ];
}

// Hailuo 2.3 Pro and Standard take the same input schema — only the model id and
// the price differ. `duration` is a string on this API, so the values are strings.
const hailuo23Controls: Control[] = [
  {
    kind: "segment",
    key: "resolution",
    label: "کیفیت",
    def: "768P",
    options: [
      { value: "768P", label: "768p" },
      { value: "1080P", label: "1080p" },
    ],
  },
  {
    kind: "segment",
    key: "duration",
    label: "مدت",
    def: "6",
    options: [
      { value: "6", label: "۶ ثانیه" },
      { value: "10", label: "۱۰ ثانیه" },
    ],
  },
];

// ElevenLabs TTS. Shared by both speech models — language_code is deliberately
// NOT here: it works on turbo-2-5 and is a documented error on multilingual-v2.
//
// The full named list lives in data/voices.ts, taken from KIE's API spec.
const elevenCommonControls: Control[] = [
  { kind: "voice", key: "voice", label: "صدا", def: "EkK5I93UQWFDigLMpZcX" },
  { kind: "slider", key: "speed", label: "سرعت گفتار", min: 0.7, max: 1.2, step: 0.05, def: 1 },
  { kind: "slider", key: "stability", label: "ثبات صدا", min: 0, max: 1, step: 0.05, def: 0.5, advanced: true },
  { kind: "slider", key: "similarity_boost", label: "شباهت به صدای اصلی", min: 0, max: 1, step: 0.05, def: 0.75, advanced: true },
  { kind: "slider", key: "style", label: "اغراق در لحن", min: 0, max: 1, step: 0.05, def: 0, advanced: true },
];

// Both Motion Control models take the same inputs. `mode` is 720p/1080p here —
// the docs' prose says "use std for 720p or pro for 1080p" but the Options list,
// which is machine-generated and has been the reliable half elsewhere, says
// 720p/1080p. character_orientation caps the output length: 10s from the image's
// orientation, 30s from the video's.
const motionControlControls: Control[] = [
  {
    kind: "segment",
    key: "mode",
    label: "کیفیت",
    def: "720p",
    options: [
      { value: "720p", label: "720p" },
      { value: "1080p", label: "1080p" },
    ],
  },
  {
    kind: "segment",
    key: "character_orientation",
    label: "جهت شخصیت",
    def: "video",
    options: [
      { value: "video", label: "از ویدیو (تا ۳۰ ثانیه)" },
      { value: "image", label: "از عکس (تا ۱۰ ثانیه)" },
    ],
  },
];

// ---- families ---------------------------------------------------------------

export const FAMILIES: Family[] = [
  // ----------------------------- IMAGE ---------------------------------------
  {
    id: "nano-banana",
    name: "Nano Banana",
    vendor: "Google",
    kind: "image",
    minTier: 2,
    blurb: "مدل تصویریِ گوگل؛ کیفیت و فهم بالا",
    badge: "محبوب",
    grad: "linear-gradient(135deg,#f6d365,#fda085)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/1756223371764w82dsmi4.png",
    refs: [{ key: "image_input", label: "تصاویر ورودی (اختیاری)", max: 8 }],
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [
          ratios.sq,
          ratios.l169,
          ratios.p916,
          ratios.l43,
          ratios.p34,
          ratios.l32,
          ratios.p23,
          ratios.l54,
          ratios.p45,
          ratios.l219,
          ratios.auto,
        ],
      },
      QUALITY("1K", ["1K", "2K", "4K"]),
      {
        kind: "segment",
        key: "output_format",
        label: "فرمت خروجی",
        def: "png",
        advanced: true,
        options: [
          { value: "png", label: "PNG" },
          { value: "jpg", label: "JPG" },
        ],
      },
    ],
    variants: [
      {
        id: "nano-banana-pro",
        featureCode: "image_generate",
        label: "Pro",
        badge: "پرچم‌دار",
        unlimited: { dailyCap: 50, minTier: 3, limits: { resolution: ["1K", "2K"] } },
      },
      {
        id: "nano-banana-2",
        featureCode: "image_generate",
        label: "نسخه ۲",
        badge: "جدید",
        unlimited: { dailyCap: 50, minTier: 3, limits: { resolution: ["1K", "2K"] } },
        refs: [{ key: "image_input", label: "تصاویر ورودی (اختیاری)", max: 14 }],
        controls: [
          {
            kind: "aspect",
            key: "aspect_ratio",
            label: "نسبت تصویر",
            def: "auto",
            options: [ratios.auto, ratios.sq, ratios.l169, ratios.p916, ratios.l43, ratios.p34, ratios.l32, ratios.p23, ratios.l219],
          },
          QUALITY("1K", ["1K", "2K", "4K"]),
          {
            kind: "segment",
            key: "output_format",
            label: "فرمت خروجی",
            def: "jpg",
            advanced: true,
            options: [
              { value: "jpg", label: "JPG" },
              { value: "png", label: "PNG" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "seedream",
    name: "Seedream",
    vendor: "ByteDance",
    kind: "image",
    minTier: 1,
    blurb: "واقع‌گرایی بالا و رنگ‌بندی سینمایی",
    badge: "محبوب",
    grad: "linear-gradient(135deg,#2bd2c0,#1e6cff)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/1756804550795qh7gkrc5.PNG",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [ratios.sq, ratios.l169, ratios.p916, ratios.l43, ratios.p34, ratios.l32, ratios.p23, ratios.l219],
      },
      {
        kind: "segment",
        key: "quality",
        label: "کیفیت",
        def: "basic",
        options: [
          { value: "basic", label: "2K" },
          { value: "high", label: "4K" },
        ],
      },
    ],
    variants: [
      // No `limits`: Seedream 4.5 has no resolution control to cap.
      { id: "seedream-4-5", featureCode: "image_generate", label: "۴٫۵" },
      { id: "seedream-5-lite", featureCode: "image_generate", label: "۵ Lite", badge: "ارزان" },
    ],
  },
  {
    id: "gpt-image",
    name: "GPT Image",
    vendor: "OpenAI",
    kind: "image",
    minTier: 1,
    blurb: "مدل تصویری OpenAI؛ دقیق در دنبال‌کردن پرامپت",
    badge: "OpenAI",
    grad: "linear-gradient(135deg,#43e97b,#38f9d7)",
    cover: "https://file.aiquickdraw.com/static/custom/page/1623/1745493643100rk4liou3.png",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "auto",
        options: [
          ratios.auto,
          ratios.sq,
          ratios.l32,
          ratios.p23,
          ratios.l43,
          ratios.p34,
          ratios.l54,
          ratios.p45,
          ratios.l169,
          ratios.p916,
          ratios.l219,
        ],
      },
      QUALITY("1K", ["1K", "2K", "4K"]),
    ],
    variants: [
      { id: "gpt-image-2", featureCode: "image_generate", label: "نسخه ۲" },
      {
        id: "gpt-image-1-5",
        featureCode: "image_generate",
        label: "۱٫۵",
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "1:1", options: [ratios.sq, ratios.p23, ratios.l32] },
          {
            kind: "segment",
            key: "quality",
            label: "کیفیت",
            def: "medium",
            options: [
              { value: "medium", label: "متعادل" },
              { value: "high", label: "بالا" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "flux",
    name: "Flux 2",
    vendor: "Black Forest Labs",
    kind: "image",
    minTier: 2,
    blurb: "ترکیب‌بندی و نور درجه‌یک",
    grad: "linear-gradient(135deg,#30cfd0,#330867)",
    cover: "https://file.aiquickdraw.com/static//kie-maket/17604346335909arn4y6a.webp",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [ratios.sq, ratios.l43, ratios.p34, ratios.l169, ratios.p916, ratios.l32, ratios.p23],
      },
      QUALITY("1K", ["1K", "2K"]),
    ],
    variants: [
      { id: "flux-2-pro", featureCode: "image_generate", label: "Pro" },
      { id: "flux-2-flex", featureCode: "image_generate", label: "Flex" },
    ],
  },
  {
    id: "imagen",
    name: "Imagen 4",
    vendor: "Google",
    kind: "image",
    minTier: 2,
    blurb: "کیفیت بالا و طبیعی از گوگل",
    badge: "Google",
    grad: "linear-gradient(135deg,#4facfe,#00f2fe)",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [ratios.sq, ratios.l169, ratios.p916, ratios.l43, ratios.p34, ratios.auto],
      },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [
      { id: "imagen-4-ultra", featureCode: "image_generate", label: "Ultra", badge: "بهترین" },
      { id: "imagen-4", featureCode: "image_generate", label: "معمولی" },
      { id: "imagen-4-fast", featureCode: "image_generate", label: "سریع", badge: "ارزان" },
    ],
  },
  {
    id: "ideogram",
    name: "Ideogram V3",
    vendor: "Ideogram",
    kind: "image",
    minTier: 2,
    blurb: "بهترین برای متن، لوگو و پوستر",
    badge: "متن و لوگو",
    grad: "linear-gradient(135deg,#ff9a9e,#fecfef)",
    controls: [
      {
        kind: "aspect",
        key: "image_size",
        label: "اندازه تصویر",
        def: "square_hd",
        options: [sizes.square_hd, sizes.l169, sizes.p169, sizes.l43, sizes.p43],
      },
      {
        kind: "segment",
        key: "rendering_speed",
        label: "حالت",
        def: "BALANCED",
        options: [
          { value: "TURBO", label: "سریع" },
          { value: "BALANCED", label: "متعادل" },
          { value: "QUALITY", label: "کیفیت" },
        ],
      },
      {
        kind: "segment",
        key: "style",
        label: "سبک",
        def: "AUTO",
        options: [
          { value: "AUTO", label: "خودکار" },
          { value: "GENERAL", label: "عمومی" },
          { value: "REALISTIC", label: "واقع‌گرا" },
          { value: "DESIGN", label: "طراحی" },
        ],
      },
      { kind: "toggle", key: "expand_prompt", label: "گسترش خودکار پرامپت", def: false, advanced: true },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [{ id: "ideogram-v3", featureCode: "image_generate", label: "V3" }],
  },
  {
    id: "qwen",
    name: "Qwen Image",
    vendor: "Alibaba",
    kind: "image",
    minTier: 1,
    blurb: "سریع و مقرون‌به‌صرفه",
    badge: "ارزان",
    grad: "linear-gradient(135deg,#a18cd1,#fbc2eb)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/17568761228997zjbv53p.png",
    controls: [
      {
        kind: "aspect",
        key: "image_size",
        label: "اندازه تصویر",
        def: "square_hd",
        options: [sizes.square_hd, sizes.l169, sizes.p169, sizes.l43, sizes.p43],
      },
      {
        kind: "segment",
        key: "acceleration",
        label: "سرعت",
        def: "none",
        advanced: true,
        options: [
          { value: "none", label: "عادی" },
          { value: "regular", label: "تند" },
          { value: "high", label: "خیلی تند" },
        ],
      },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [{ id: "qwen-image", featureCode: "image_generate", label: "Image" }],
  },
  {
    id: "z-image",
    name: "Z-Image",
    vendor: "Tongyi",
    kind: "image",
    minTier: 1,
    blurb: "اقتصادی برای تست‌های سریع",
    badge: "ارزان‌ترین",
    grad: "linear-gradient(135deg,#89f7fe,#66a6ff)",
    cover: "https://file.aiquickdraw.com/static//kie-maket/176043358319433328iqf.png",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [ratios.sq, ratios.l43, ratios.p34, ratios.l169, ratios.p916],
      },
    ],
    variants: [{ id: "z-image", featureCode: "image_generate", label: "Z" }],
  },

  // ----------------------------- VIDEO ---------------------------------------
  {
    id: "seedance",
    name: "Seedance",
    maxPrompt: 20000,
    vendor: "ByteDance",
    kind: "video",
    minTier: 2,
    blurb: "ویدیوی واقع‌گرا با صدا؛ متن یا عکس به ویدیو",
    badge: "پرچم‌دار",
    grad: "linear-gradient(135deg,#4b6cf7,#9b4bf7)",
    // Seedance 2 takes reference_image_urls / reference_video_urls /
    // reference_audio_urls — there is no first_frame_url or last_frame_url on
    // this API, so those two slots were uploading into fields that don't exist.
    // Supplying a video also switches KIE to its cheaper "with video input" rate
    // (25 vs 41 credits/s at 720p); pricing still quotes the dearer one, so that
    // difference lands in our margin rather than the user's bill.
    refs: [
      { key: "reference_image_urls", label: "تصاویر مرجع / سوژه (اختیاری)", max: 9, maxMb: 30 },
      { key: "reference_video_urls", label: "ویدیوی مرجع (اختیاری)", max: 3, media: "video", maxMb: 50 },
      { key: "reference_audio_urls", label: "صدای مرجع (اختیاری)", max: 3, media: "audio", maxMb: 15 },
    ],
    controls: seedanceControls(["480p", "720p", "1080p", "4k"]),
    variants: [
      /* 2.5 leads. It is the newest and it is what ByteDance and the reference
         are both promoting, but the real reason it goes first is the duration:
         it renders a native 30-second single shot, where every other variant
         here tops out at 15 and gets longer only by stitching. That is a
         different product, not a faster one, so it gets its own control rather
         than inheriting seedanceControls' 4–15 slider.

         480p / 720p only — those are the resolutions it offers and the only
         two KIE prices. */
      {
        id: "seedance-2-5",
        featureCode: "video_generate",
        label: "۲٫۵",
        badge: "جدید",
        controls: [
          {
            kind: "aspect",
            key: "aspect_ratio",
            label: "نسبت تصویر",
            def: "16:9",
            options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219],
          },
          QUALITY("720p", ["480p", "720p"]),
          { kind: "slider", key: "duration", label: "مدت", min: 4, max: 30, step: 1, def: 5, unit: "ثانیه" },
          { kind: "toggle", key: "generate_audio", label: "تولید صدا", def: true },
        ],
      },
      { id: "seedance-2", featureCode: "video_generate", label: "نسخه ۲", badge: "پرچم‌دار" },
      {
        id: "seedance-2-fast",
        featureCode: "video_generate",
        label: "سریع",
        controls: seedanceControls(["480p", "720p"]),
      },
      /* Mini was held back because KIE priced it while the service still said
         "coming soon". It ships now — the endpoint is live — so it goes in. At
         8.2 credits/second against Seedance 2's 41 it is the cheap seat of the
         family, which is the whole point of it. */
      {
        id: "seedance-2-mini",
        featureCode: "video_generate",
        label: "۲ مینی",
        badge: "ارزان",
        controls: seedanceControls(["480p", "720p"]),
      },
      {
        id: "seedance-1-5-pro",
        featureCode: "video_generate",
        label: "۱٫۵ Pro",
        refs: [{ key: "input_urls", label: "تصاویر ورودی (اختیاری)", max: 2 }],
        controls: [
          {
            kind: "aspect",
            key: "aspect_ratio",
            label: "نسبت تصویر",
            def: "16:9",
            options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219],
          },
          QUALITY("720p", ["480p", "720p", "1080p"]),
          // 1.5 Pro moves in 2s steps (4/6/8/10/12), unlike Seedance 2's 1s.
          // The old slider stepped by 1 and defaulted to 5, which isn't a legal value.
          { kind: "slider", key: "duration", label: "مدت", min: 4, max: 12, step: 2, def: 8, unit: "ثانیه" },
          { kind: "toggle", key: "generate_audio", label: "تولید صدا", def: false },
          { kind: "toggle", key: "fixed_lens", label: "دوربین ثابت", def: false, advanced: true },
        ],
      },
    ],
  },
  {
    id: "kling",
    name: "Kling",
    // 2500 on Turbo, 2.6, 2.5 Turbo and both Motion Controls. 3.0 puts its
    // prompt inside `shots` and states no limit; it inherits this, which can
    // only be too strict, never too loose.
    maxPrompt: 2500,
    vendor: "Kuaishou",
    kind: "video",
    minTier: 2,
    blurb: "حرکت سینمایی و چندنما؛ تا ۱۵ ثانیه",
    badge: "سینمایی",
    grad: "linear-gradient(135deg,#f7c948,#f86a3b)",
    cover: "https://file.aiquickdraw.com/static//kie-maket/17622493381934oqt0mus.mp4",
    refs: [{ key: "image_urls", label: "فریم شروع و پایان (اختیاری)", max: 2 }],
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "16:9",
        options: [ratios.l169, ratios.p916, ratios.sq],
      },
      // Kling 3.0 has no `resolution` field. It takes a required `mode` of
      // std | pro | 4K, which the rate table lists as 720P / 1080P / 4K.
      {
        kind: "segment",
        key: "mode",
        label: "کیفیت",
        def: "pro",
        options: [
          { value: "std", label: "720p" },
          { value: "pro", label: "1080p" },
          { value: "4K", label: "4K" },
        ],
      },
      // There is no top-level duration or prompt on this model — both are
      // serialised into the `shots` JSON string ({"prompt": …, "duration": …}).
      // The control stays because duration still drives the per-second price and
      // the backend needs the value to build `shots`.
      { kind: "slider", key: "duration", label: "مدت", min: 3, max: 15, step: 1, def: 5, unit: "ثانیه", asString: true },
      // API default is true, and sound doubles the price, so it must always be
      // sent explicitly rather than left out.
      { kind: "toggle", key: "sound", label: "تولید صدا", def: false },
      { kind: "toggle", key: "multi_shots", label: "چندنما (روایت چندبخشی)", def: false, advanced: true },
    ],
    variants: [
      { id: "kling-3", featureCode: "video_generate", label: "۳٫۰" },
      {
        // Turbo exposes neither sound nor multi_shots, and tops out at 1080p, so
        // it can't inherit the family controls. aspect_ratio exists on the
        // text-to-video model only — with an input image the frame comes from the
        // image, so the backend must drop aspect_ratio when it calls image-to-video.
        id: "kling-3-turbo",
        featureCode: "video_generate",
        label: "۳٫۰ Turbo",
        badge: "سریع",
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          {
            kind: "segment",
            key: "resolution",
            label: "کیفیت",
            def: "720p",
            options: [
              { value: "720p", label: "720p" },
              { value: "1080p", label: "1080p" },
            ],
          },
          { kind: "slider", key: "duration", label: "مدت", min: 3, max: 15, step: 1, def: 5, unit: "ثانیه" },
        ],
      },
      {
        id: "kling-2-6",
        featureCode: "video_generate",
        label: "۲٫۶",
        // Not the family slot: 2.6 takes one source image, not a start/end frame
        // pair. Its image-to-video model also drops aspect_ratio — the frame comes
        // from the image — so the backend must omit that field when an image is set.
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          {
            kind: "segment",
            key: "duration",
            label: "مدت",
            def: "5",
            options: [
              { value: "5", label: "۵ ثانیه" },
              { value: "10", label: "۱۰ ثانیه" },
            ],
          },
          { kind: "toggle", key: "sound", label: "تولید صدا", def: false },
        ],
      },
      {
        // Motion transfer: the character comes from the image, the movement from
        // the video. Both required. `mode` here means 720p/1080p — not the
        // std/pro/4K that the same field name means on kling-3.0/video.
        id: "kling-3-motion",
        featureCode: "image_to_video",
        label: "Motion Control",
        badge: "جدید",
        refs: [
          { key: "input_urls", label: "تصویر شخصیت (الزامی)", max: 1, required: true, maxMb: 10 },
          { key: "video_urls", label: "ویدیوی حرکت (الزامی)", max: 1, required: true, media: "video", maxMb: 100 },
        ],
        controls: motionControlControls,
      },
      {
        id: "kling-2-6-motion",
        featureCode: "image_to_video",
        label: "Motion Control ۲٫۶",
        badge: "ارزان",
        refs: [
          { key: "input_urls", label: "تصویر شخصیت (الزامی)", max: 1, required: true, maxMb: 10 },
          { key: "video_urls", label: "ویدیوی حرکت (الزامی)", max: 1, required: true, media: "video", maxMb: 100 },
        ],
        controls: motionControlControls,
      },
      {
        id: "kling-2-5-turbo",
        featureCode: "video_generate",
        label: "۲٫۵ Turbo",
        // The image-to-video model names its frames separately — image_url and
        // tail_image_url — instead of one image_urls array, and drops
        // aspect_ratio, which follows the start frame.
        refs: [
          { key: "image_url", group: "frame" as const, label: "فریم شروع (اختیاری)", max: 1 },
          { key: "tail_image_url", group: "frame" as const, label: "فریم پایان", max: 1, requires: "image_url" },
        ],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          {
            kind: "segment",
            key: "duration",
            label: "مدت",
            def: "5",
            options: [
              { value: "5", label: "۵ ثانیه" },
              { value: "10", label: "۱۰ ثانیه" },
            ],
          },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          { kind: "slider", key: "cfg_scale", label: "پایبندی به پرامپت", min: 0, max: 1, step: 0.1, def: 0.5, advanced: true },
        ],
      },
    ],
  },
  /* MiniMax H3.
     Its own family rather than a variant of Hailuo 2.3: 2.3 is image-to-video
     only and this takes text, an image, or up to nine references plus motion
     and audio clips, at 2K with synchronised sound. Same vendor, different
     product — folding it in would put a frontier model behind a label that
     says "2.3".

     Third among the video families, not first. The catalog order is what the
     comparison table reads as "most used", and a model released this month has
     not earned that yet however loudly it is being promoted.

     768p and 2K only. fal exposes a 4K tier, but KIE — the provider we actually
     bill through — does not price it, and an option whose rate resolves to null
     renders as "not supported" with a dead create button. Better to not offer
     it until there is a number behind it. */
  {
    id: "minimax-h3",
    name: "MiniMax H3",
    maxPrompt: 5000,
    vendor: "MiniMax",
    kind: "video",
    minTier: 2,
    blurb: "یک مدل برای همه‌چیز: متن، عکس یا مرجع به ویدیوی ۲K با صدای همگام",
    badge: "جدید",
    grad: "linear-gradient(135deg,#f7734b,#f74b9b)",
    refs: [
      { key: "reference_image_urls", label: "تصاویر مرجع / سوژه (اختیاری)", max: 9, maxMb: 30 },
      { key: "reference_video_urls", label: "ویدیوی مرجع برای حرکت (اختیاری)", max: 3, media: "video", maxMb: 50 },
      { key: "reference_audio_urls", label: "صدای مرجع (اختیاری)", max: 3, media: "audio", maxMb: 15 },
    ],
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "16:9",
        options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219],
      },
      QUALITY("2K", ["768p", "2K"]),
      // 5–15s, per the model's own schema. No 4s floor like Seedance.
      { kind: "slider", key: "duration", label: "مدت", min: 5, max: 15, step: 1, def: 5, unit: "ثانیه" },
    ],
    variants: [
      // One variant: KIE prices text-to-video, image-to-video and
      // reference-to-video identically, so splitting them would be three rows
      // of the same number.
      { id: "minimax-h3", featureCode: "video_generate", label: "H3", badge: "جدید" },
    ],
  },
  {
    id: "wan",
    name: "Wan",
    maxPrompt: 5000, // 2.6, 2.7 and R2V — but 2.5 is far tighter, see below
    vendor: "Alibaba",
    kind: "video",
    minTier: 1,
    blurb: "ویدیوی روان و اقتصادی",
    badge: "ارزان",
    grad: "linear-gradient(135deg,#ff5db1,#7b4dff)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/1758796495606nze1vzkk.mp4",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "16:9",
        options: [ratios.l169, ratios.p916, ratios.sq],
      },
      {
        kind: "segment",
        key: "resolution",
        label: "کیفیت",
        def: "720p",
        options: [
          { value: "720p", label: "720p" },
          { value: "1080p", label: "1080p" },
        ],
      },
      {
        kind: "segment",
        key: "duration",
        label: "مدت",
        def: "5",
        options: [
          { value: "5", label: "۵ ثانیه" },
          { value: "10", label: "۱۰ ثانیه" },
        ],
      },
      { kind: "toggle", key: "enable_prompt_expansion", label: "گسترش خودکار پرامپت", def: false, advanced: true },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [
      {
        // The family controls above are 2.5's: aspect_ratio and
        // enable_prompt_expansion really are its field names, unlike 2.6 (which
        // has neither) and 2.7 (which calls them ratio and prompt_extend).
        // Its image model names the slot image_url — singular, one string — and
        // has no aspect_ratio; the frame follows the image.
        id: "wan-2-5",
        featureCode: "video_generate",
        maxPrompt: 800, // tightest in the catalog — a detailed prompt passes it easily
        label: "۲٫۵",
        refs: [{ key: "image_url", label: "تصویر ورودی (اختیاری)", max: 1 }],
      },
      {
        id: "wan-2-6",
        featureCode: "video_generate",
        label: "۲٫۶",
        // 2.6 has no aspect/ratio field and no negative_prompt, unlike 2.7 — so it
        // must not inherit the family controls. It had no upload slot at all,
        // which left its image-to-video model unreachable.
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          {
            kind: "segment",
            key: "resolution",
            label: "کیفیت",
            def: "1080p",
            options: [
              { value: "720p", label: "720p" },
              { value: "1080p", label: "1080p" },
            ],
          },
          {
            kind: "segment",
            key: "duration",
            label: "مدت",
            def: "5",
            options: [
              { value: "5", label: "۵ ثانیه" },
              { value: "10", label: "۱۰ ثانیه" },
              { value: "15", label: "۱۵ ثانیه" },
            ],
          },
          { kind: "toggle", key: "multi_shots", label: "چندنما (روایت چندبخشی)", def: false, advanced: true },
        ],
      },
      {
        id: "wan-2-7",
        featureCode: "video_generate",
        label: "۲٫۷",
        // Note the field is `ratio` here, not `aspect_ratio` as everywhere else,
        // and the image-to-video model drops it entirely — the frame follows the
        // first image.
        refs: [
          { key: "first_frame_url", group: "frame" as const, label: "فریم شروع (اختیاری)", max: 1, maxMb: 30 },
          { key: "last_frame_url", group: "frame" as const, label: "فریم پایان (اختیاری)", max: 1, maxMb: 30 },
          { key: "first_clip_url", group: "frame" as const, label: "کلیپ شروع (اختیاری)", max: 1, media: "video", maxMb: 30 },
          { key: "driving_audio_url", label: "صدای هدایت‌گر (اختیاری)", max: 1, media: "audio", maxMb: 50 },
        ],
        controls: [
          {
            kind: "aspect",
            key: "ratio",
            label: "نسبت تصویر",
            def: "16:9",
            options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34],
          },
          {
            kind: "segment",
            key: "resolution",
            label: "کیفیت",
            def: "1080p",
            options: [
              { value: "720p", label: "720p" },
              { value: "1080p", label: "1080p" },
            ],
          },
          { kind: "slider", key: "duration", label: "مدت", min: 2, max: 15, step: 1, def: 5, unit: "ثانیه" },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          // API default is true; kept on to match, but now visible and switchable.
          { kind: "toggle", key: "prompt_extend", label: "گسترش خودکار پرامپت", def: true, advanced: true },
          { kind: "toggle", key: "watermark", label: "واترمارک", def: false, advanced: true },
        ],
      },
      {
        // Edits an uploaded video. Priced per second of the *output*, and
        // `duration` decides what that is: 0 keeps the whole source clip, any
        // other value trims from the start.
        //
        // Its own doc contradicts itself on the legal values — the Range field
        // says 2-10 step 1, which admits 1, while the description says "0 or any
        // integer in [2,10]". The description is the stricter reading, so 1 is
        // not offered.
        id: "wan-2-7-videoedit",
        featureCode: "video_edit",
        label: "۲٫۷ ویرایش",
        badge: "ویدیو",
        refs: [
          { key: "video_url", label: "ویدیوی ورودی (الزامی)", max: 1, required: true, media: "video", maxMb: 100 },
          { key: "reference_image", label: "تصویر مرجع (اختیاری)", max: 1, maxMb: 30 },
        ],
        controls: [
          {
            kind: "segment",
            key: "resolution",
            label: "کیفیت",
            def: "720p",
            options: [
              { value: "720p", label: "720p" },
              { value: "1080p", label: "1080p" },
            ],
          },
          // Sent as a number by the backend, unlike the string durations elsewhere.
          {
            kind: "segment",
            key: "duration",
            label: "مدت خروجی",
            def: "0",
            options: [
              { value: "0", label: "کل ویدیو" },
              { value: "2", label: "۲ ثانیه" },
              { value: "4", label: "۴ ثانیه" },
              { value: "6", label: "۶ ثانیه" },
              { value: "8", label: "۸ ثانیه" },
              { value: "10", label: "۱۰ ثانیه" },
            ],
          },
          {
            kind: "aspect",
            key: "aspect_ratio",
            label: "نسبت تصویر",
            def: "16:9",
            options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34],
          },
          {
            kind: "segment",
            key: "audio_setting",
            label: "صدا",
            def: "auto",
            options: [
              { value: "auto", label: "خودکار" },
              { value: "origin", label: "حفظ صدای اصلی" },
            ],
          },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          { kind: "toggle", key: "prompt_extend", label: "گسترش خودکار پرامپت", def: true, advanced: true },
          { kind: "toggle", key: "watermark", label: "واترمارک", def: false, advanced: true },
        ],
      },
      {
        // Reference-to-video. KIE requires at least one reference image OR video,
        // capped at five between them; since only images can be uploaded today,
        // the image slot is marked required and holds all five.
        // reference_video and reference_voice are left out until media slots exist.
        // Note this model uses `aspect_ratio` while its text-to-video sibling
        // uses `ratio` — same family, different field name.
        id: "wan-2-7-r2v",
        featureCode: "image_to_video",
        label: "۲٫۷ مرجع",
        refs: [
          { key: "reference_image", label: "تصاویر مرجع (الزامی)", max: 5, required: true },
          { key: "first_frame", group: "frame" as const, label: "فریم شروع (اختیاری)", max: 1 },
        ],
        controls: [
          {
            kind: "aspect",
            key: "aspect_ratio",
            label: "نسبت تصویر",
            def: "16:9",
            options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34],
          },
          {
            kind: "segment",
            key: "resolution",
            label: "کیفیت",
            def: "1080p",
            options: [
              { value: "720p", label: "720p" },
              { value: "1080p", label: "1080p" },
            ],
          },
          // The doc contradicts itself — prose says the default is 5, the Default
          // Value field says 9. Taking 5: cheaper, and it matches every other Wan.
          { kind: "slider", key: "duration", label: "مدت", min: 2, max: 10, step: 1, def: 5, unit: "ثانیه" },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          { kind: "toggle", key: "prompt_extend", label: "گسترش خودکار پرامپت", def: true, advanced: true },
          { kind: "toggle", key: "watermark", label: "واترمارک", def: false, advanced: true },
        ],
      },
    ],
  },
  {
    id: "hailuo",
    name: "Hailuo 2.3",
    maxPrompt: 5000,
    vendor: "MiniMax",
    kind: "video",
    minTier: 1,
    blurb: "حرکت طبیعی و چهره‌های واقعی؛ عکس به ویدیو",
    badge: "MiniMax",
    grad: "linear-gradient(135deg,#ee9ca7,#ffdde1)",
    controls: hailuo23Controls,
    variants: [
      // 2.3 is image-to-video only, and KIE ships Pro and Standard as separate
      // models. Standard was missing entirely — it is a third of the price.
      // Neither offers 10s at 1080P; pricing returns null for that pair.
      {
        id: "hailuo-2-3",
        featureCode: "image_to_video",
        label: "۲٫۳ Pro",
        refs: [{ key: "image_url", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
        controls: hailuo23Controls,
      },
      {
        id: "hailuo-2-3-standard",
        featureCode: "image_to_video",
        label: "۲٫۳ استاندارد",
        badge: "ارزان",
        refs: [{ key: "image_url", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
        controls: hailuo23Controls,
      },
    ],
  },
  {
    // KIE also prices a "with video input" path, and the duration docs mention
    // video input deciding the length — but no video parameter is documented,
    // only image_urls, and it accepts image types only. Not implemented until
    // that field is confirmed; the image/text path below is fully documented.
    id: "gemini-omni",
    name: "Gemini Omni",
    maxPrompt: 20000,
    vendor: "Google",
    kind: "video",
    minTier: 2,
    blurb: "ویدیو و صدای همزمان؛ ورودی عکس اختیاری",
    badge: "جدید",
    grad: "linear-gradient(135deg,#34d399,#3b82f6)",
    // The API documents no cap on the number of images; this is a UI limit.
    refs: [{ key: "image_urls", label: "تصاویر ورودی (اختیاری)", max: 4 }],
    controls: [
      { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916] },
      // 720p and 1080p cost exactly the same at every duration, so 720p is
      // strictly worse for the user. Defaulting to 1080p; KIE's own default is 720p.
      QUALITY("1080p", ["720p", "1080p", "4k"]),
      {
        kind: "segment",
        key: "duration",
        label: "مدت",
        def: "8",
        options: [
          { value: "4", label: "۴ ثانیه" },
          { value: "6", label: "۶ ثانیه" },
          { value: "8", label: "۸ ثانیه" },
          { value: "10", label: "۱۰ ثانیه" },
        ],
      },
    ],
    variants: [{ id: "gemini-omni-video", featureCode: "video_generate", label: "Omni" }],
  },
  // Veo is the one model not on /api/v1/jobs/createTask. Confirmed against its
  // API page: POST /api/v1/veo/generate, model = veo3 | veo3_fast | veo3_lite.
  // The backend needs a separate path for it, and must send `generationType`,
  // which nothing else has:
  //   TEXT_2_VIDEO                   no images
  //   FIRST_AND_LAST_FRAMES_2_VIDEO  one image (video unfolds around it) or two
  //                                  (first and last frame)
  //   REFERENCE_2_VIDEO              material-to-video — veo3_fast and veo3_lite
  //                                  only, never veo3
  // Other fields with no control here: watermark (a brand *string*, not a flag),
  // enableFallback, enableTranslation.
  // 4K bills roughly 120 credits above 1080p, and the 4K rate rows already
  // include it — 35→150, 65→180, 255→380 — so no separate charge to account for.
  {
    id: "veo",
    name: "Veo 3.1",
    vendor: "Google",
    kind: "video",
    minTier: 3,
    blurb: "پرچم‌دارِ ویدیوی گوگل؛ کیفیت سینمایی و صدا",
    badge: "جدید",
    grad: "linear-gradient(135deg,#0ea5e9,#6366f1)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/1760692238600spjz047p.mp4",
    refs: [{ key: "imageUrls", label: "تصاویر مرجع / فریم (اختیاری)", max: 2 }],
    controls: [
      { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916] },
      QUALITY("720p", ["720p", "1080p", "4k"]),
      {
        kind: "segment",
        key: "duration",
        label: "مدت",
        def: "8",
        options: [
          { value: "4", label: "۴ ثانیه" },
          { value: "6", label: "۶ ثانیه" },
          { value: "8", label: "۸ ثانیه" },
        ],
      },
    ],
    variants: [
      { id: "veo-fast", featureCode: "video_generate", label: "سریع", badge: "ارزان" },
      { id: "veo-quality", featureCode: "video_generate", label: "کیفیت", badge: "پرچم‌دار" },
      { id: "veo-lite", featureCode: "video_generate", label: "Lite" },
    ],
  },
  {
    id: "grok-image",
    name: "Grok Imagine",
    vendor: "xAI",
    kind: "image",
    minTier: 1,
    blurb: "تصویرسازِ سریعِ xAI",
    badge: "xAI",
    grad: "linear-gradient(135deg,#3b3f46,#1c1f24)",
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "1:1",
        options: [ratios.sq, ratios.p23, ratios.l32, ratios.l169, ratios.p916],
      },
      { kind: "toggle", key: "enable_pro", label: "حالت کیفیت", def: false },
    ],
    variants: [{ id: "grok-image", featureCode: "image_generate", label: "Imagine" }],
  },
  // ----------------------------- AUDIO ---------------------------------------
  {
    // Billed per 1000 characters of input, so unlike everything else here the
    // price comes from the prompt's length rather than the settings.
    // The API field is `text`, not `prompt` — the backend has to rename it.
    id: "elevenlabs",
    name: "ElevenLabs",
    vendor: "ElevenLabs",
    kind: "audio",
    minTier: 1,
    blurb: "متن به گفتار؛ طبیعی و چندزبانه — فارسی هم پشتیبانی می‌شود",
    badge: "صدا",
    grad: "linear-gradient(135deg,#22d3ee,#0f766e)",
    maxPrompt: 5000,
    controls: elevenCommonControls,
    variants: [
      {
        // The only one that accepts language_code. Sending that field to
        // multilingual-v2 is a documented error, so it lives here and nowhere else.
        id: "eleven-turbo",
        featureCode: "speech_generate",
        label: "Turbo",
        badge: "ارزان",
        controls: [
          ...elevenCommonControls,
          {
            kind: "segment",
            key: "language_code",
            label: "زبان",
            def: "",
            advanced: true,
            options: [
              { value: "", label: "خودکار" },
              { value: "fa", label: "فارسی" },
              { value: "en", label: "انگلیسی" },
              { value: "ar", label: "عربی" },
            ],
          },
        ],
      },
      {
        id: "eleven-multilingual",
        featureCode: "speech_generate",
        label: "چندزبانه",
        badge: "کیفیت",
      },
    ],
  },

  // ----------------------------- TOOLS ---------------------------------------
  // These transform an uploaded file rather than generating from a description,
  // so they carry no prompt at all.
  {
    id: "topaz",
    name: "Topaz",
    vendor: "Topaz Labs",
    kind: "image",
    minTier: 1,
    blurb: "بزرگ‌نمایی تصویر با حفظ جزئیات",
    badge: "ابزار",
    grad: "linear-gradient(135deg,#64748b,#1e293b)",
    noPrompt: true,
    refs: [{ key: "image_url", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
    controls: [
      // The API takes 1/2/4/8 but the rate table is keyed 2K/4K/8K, with nothing
      // for 1x — so 1x is left out rather than sold at a made-up price. Which
      // factor lands in which tier is inferred from the numbers lining up;
      // confirm against a real job's creditsConsumed before it matters.
      {
        kind: "segment",
        key: "upscale_factor",
        label: "بزرگ‌نمایی",
        def: "2",
        options: [
          { value: "2", label: "۲ برابر" },
          { value: "4", label: "۴ برابر" },
          { value: "8", label: "۸ برابر" },
        ],
      },
    ],
    variants: [
      { id: "topaz-image-upscale", featureCode: "image_edit", label: "بزرگ‌نمایی" },
      {
        // Per second of the source clip, like Motion Control — so it can't be
        // priced until a video is attached. 1x and 2x share a rate row; 8x has none.
        id: "topaz-video-upscale",
        featureCode: "video_edit",
        label: "ویدیو",
        refs: [{ key: "video_url", label: "ویدیوی ورودی (الزامی)", max: 1, required: true, media: "video", maxMb: 50 }],
        controls: [
          {
            kind: "segment",
            key: "upscale_factor",
            label: "بزرگ‌نمایی",
            def: "2",
            options: [
              { value: "1", label: "۱ برابر" },
              { value: "2", label: "۲ برابر" },
              { value: "4", label: "۴ برابر" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "recraft",
    name: "Recraft",
    vendor: "Recraft",
    kind: "image",
    minTier: 1,
    blurb: "بزرگ‌نمایی سریع و حذف پس‌زمینه",
    badge: "ابزار",
    grad: "linear-gradient(135deg,#a78bfa,#4c1d95)",
    noPrompt: true,
    // Note the field is `image` here, where Topaz calls the same thing image_url.
    refs: [{ key: "image", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
    controls: [],
    variants: [
      { id: "recraft-crisp-upscale", featureCode: "image_edit", label: "بزرگ‌نمایی", badge: "ارزان" },
      { id: "recraft-remove-bg", featureCode: "image_edit", label: "حذف پس‌زمینه" },
    ],
  },
];

export const IMAGE_FAMILIES = FAMILIES.filter((f) => f.kind === "image");
export const VIDEO_FAMILIES = FAMILIES.filter((f) => f.kind === "video");
export const AUDIO_FAMILIES = FAMILIES.filter((f) => f.kind === "audio");

export function getFamily(id: string): Family | undefined {
  return FAMILIES.find((f) => f.id === id);
}

export function variantControls(family: Family, variant: Variant): Control[] {
  return variant.controls ?? family.controls;
}

export function variantRefs(family: Family, variant: Variant): RefSlot[] {
  if (variant.refs === null) return [];
  return variant.refs ?? family.refs ?? [];
}

/** Prompt character limit for this variant, or null where it isn't known yet. */
export function variantMaxPrompt(family: Family, variant: Variant): number | null {
  return variant.maxPrompt ?? family.maxPrompt ?? null;
}

/**
 * Default input object from a control list, ready to send to KIE.
 *
 * `voice` and `text` used to fall through this chain. The voice picker renders
 * `control.def` when it has no value, so a voice *looked* selected while
 * `input.voice` stayed undefined until the user tapped a row — meaning every
 * speech job created without touching the picker would have run on KIE's
 * server-side default voice rather than the one on screen. Nothing surfaced it
 * because `input` is not serialised anywhere yet.
 *
 * The exhaustive `switch` is the point: a new Control kind is now a compile
 * error here instead of another silently missing field.
 */
export function defaultInput(controls: Control[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const c of controls) {
    switch (c.kind) {
      case "aspect":
      case "segment":
      case "toggle":
      case "voice":
        out[c.key] = c.def;
        break;
      case "slider":
        out[c.key] = c.asString ? String(c.def) : c.def;
        break;
      case "text":
        // The only kind with no `def` — an empty box is its default.
        out[c.key] = "";
        break;
      default: {
        const unhandled: never = c;
        void unhandled;
      }
    }
  }
  return out;
}
