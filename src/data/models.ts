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

export interface RefSlot {
  key: string;
  label: string;
  max: number;
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

/** One concrete KIE model inside a family. */
export interface Variant {
  id: string; // our id (also the pricing key)
  model: string; // KIE createTask `model` field
  /**
   * KIE splits some models into separate text-to-video and image-to-video entry
   * points (`kling-2.6/text-to-video` vs `kling-2.6/image-to-video`). Where that
   * is the case, `model` is the text-only one and this is used instead as soon as
   * the user supplies a reference image. Same price either way — the rate rows
   * for the two are identical — so this only selects the endpoint.
   */
  modelWithRefs?: string;
  /** Prompt character limit, when it differs from the family's. */
  maxPrompt?: number;
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
  { kind: "segment", key: "resolution", label: "کیفیت", def: "768P", options: [
    { value: "768P", label: "768p" }, { value: "1080P", label: "1080p" },
  ] },
  { kind: "segment", key: "duration", label: "مدت", def: "6", options: [
    { value: "6", label: "۶ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
  ] },
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

// ---- families ---------------------------------------------------------------

export const FAMILIES: Family[] = [
  // ----------------------------- IMAGE ---------------------------------------
  {
    id: "nano-banana",
    name: "Nano Banana",
    vendor: "Google",
    kind: "image",
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
        options: [ratios.sq, ratios.l169, ratios.p916, ratios.l43, ratios.p34, ratios.l32, ratios.p23, ratios.l54, ratios.p45, ratios.l219, ratios.auto],
      },
      QUALITY("1K", ["1K", "2K", "4K"]),
      { kind: "segment", key: "output_format", label: "فرمت خروجی", def: "png", advanced: true, options: [
        { value: "png", label: "PNG" }, { value: "jpg", label: "JPG" },
      ] },
    ],
    variants: [
      {
        id: "nano-banana-pro",
        model: "nano-banana-pro",
        label: "Pro",
        badge: "پرچم‌دار",
      },
      {
        id: "nano-banana-2",
        model: "nano-banana-2",
        label: "نسخه ۲",
        badge: "جدید",
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
          { kind: "segment", key: "output_format", label: "فرمت خروجی", def: "jpg", advanced: true, options: [
            { value: "jpg", label: "JPG" }, { value: "png", label: "PNG" },
          ] },
        ],
      },
    ],
  },
  {
    id: "seedream",
    name: "Seedream",
    vendor: "ByteDance",
    kind: "image",
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
      { kind: "segment", key: "quality", label: "کیفیت", def: "basic", options: [
        { value: "basic", label: "2K" }, { value: "high", label: "4K" },
      ] },
    ],
    variants: [
      { id: "seedream-4-5", model: "seedream/4.5-text-to-image", label: "۴٫۵" },
      { id: "seedream-5-lite", model: "seedream/5-lite-text-to-image", label: "۵ Lite", badge: "ارزان" },
    ],
  },
  {
    id: "gpt-image",
    name: "GPT Image",
    vendor: "OpenAI",
    kind: "image",
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
        options: [ratios.auto, ratios.sq, ratios.l32, ratios.p23, ratios.l43, ratios.p34, ratios.l54, ratios.p45, ratios.l169, ratios.p916, ratios.l219],
      },
      QUALITY("1K", ["1K", "2K", "4K"]),
    ],
    variants: [
      { id: "gpt-image-2", model: "gpt-image-2-text-to-image", label: "نسخه ۲" },
      {
        id: "gpt-image-1-5",
        model: "gpt-image/1.5-text-to-image",
        label: "۱٫۵",
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "1:1", options: [ratios.sq, ratios.p23, ratios.l32] },
          { kind: "segment", key: "quality", label: "کیفیت", def: "medium", options: [
            { value: "medium", label: "متعادل" }, { value: "high", label: "بالا" },
          ] },
        ],
      },
    ],
  },
  {
    id: "flux",
    name: "Flux 2",
    vendor: "Black Forest Labs",
    kind: "image",
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
      { id: "flux-2-pro", model: "flux-2/pro-text-to-image", label: "Pro" },
      { id: "flux-2-flex", model: "flux-2/flex-text-to-image", label: "Flex" },
    ],
  },
  {
    id: "imagen",
    name: "Imagen 4",
    vendor: "Google",
    kind: "image",
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
      { id: "imagen-4-ultra", model: "google/imagen4-ultra", label: "Ultra", badge: "بهترین" },
      { id: "imagen-4", model: "google/imagen4", label: "معمولی" },
      { id: "imagen-4-fast", model: "google/imagen4-fast", label: "سریع", badge: "ارزان" },
    ],
  },
  {
    id: "ideogram",
    name: "Ideogram V3",
    vendor: "Ideogram",
    kind: "image",
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
      { kind: "segment", key: "rendering_speed", label: "حالت", def: "BALANCED", options: [
        { value: "TURBO", label: "سریع" }, { value: "BALANCED", label: "متعادل" }, { value: "QUALITY", label: "کیفیت" },
      ] },
      { kind: "segment", key: "style", label: "سبک", def: "AUTO", options: [
        { value: "AUTO", label: "خودکار" }, { value: "GENERAL", label: "عمومی" }, { value: "REALISTIC", label: "واقع‌گرا" }, { value: "DESIGN", label: "طراحی" },
      ] },
      { kind: "toggle", key: "expand_prompt", label: "گسترش خودکار پرامپت", def: false, advanced: true },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [{ id: "ideogram-v3", model: "ideogram/v3-text-to-image", label: "V3" }],
  },
  {
    id: "qwen",
    name: "Qwen Image",
    vendor: "Alibaba",
    kind: "image",
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
      { kind: "segment", key: "acceleration", label: "سرعت", def: "none", advanced: true, options: [
        { value: "none", label: "عادی" }, { value: "regular", label: "تند" }, { value: "high", label: "خیلی تند" },
      ] },
      { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
    ],
    variants: [{ id: "qwen-image", model: "qwen/text-to-image", label: "Image" }],
  },
  {
    id: "z-image",
    name: "Z-Image",
    vendor: "Tongyi",
    kind: "image",
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
    variants: [{ id: "z-image", model: "z-image", label: "Z" }],
  },

  // ----------------------------- VIDEO ---------------------------------------
  {
    id: "seedance",
    name: "Seedance",
    maxPrompt: 20000,
    vendor: "ByteDance",
    kind: "video",
    blurb: "ویدیوی واقع‌گرا با صدا؛ متن یا عکس به ویدیو",
    badge: "پرچم‌دار",
    grad: "linear-gradient(135deg,#4b6cf7,#9b4bf7)",
    // Seedance 2 takes reference_image_urls / reference_video_urls /
    // reference_audio_urls — there is no first_frame_url or last_frame_url on
    // this API, so those two slots were uploading into fields that don't exist.
    // The video and audio reference slots need media kinds the uploader can't
    // do yet, so only images are wired up.
    refs: [{ key: "reference_image_urls", label: "تصاویر مرجع / سوژه (اختیاری)", max: 9 }],
    controls: seedanceControls(["480p", "720p", "1080p", "4k"]),
    variants: [
      { id: "seedance-2", model: "bytedance/seedance-2", label: "نسخه ۲", badge: "پرچم‌دار" },
      { id: "seedance-2-fast", model: "bytedance/seedance-2-fast", label: "سریع", controls: seedanceControls(["480p", "720p"]) },
      // Seedance 2 Mini is priced in KIE's rate table but still shows "coming
      // soon" on the service, so it can't actually run. Restore when it ships.
      {
        id: "seedance-1-5-pro",
        model: "bytedance/seedance-1.5-pro",
        label: "۱٫۵ Pro",
        refs: [{ key: "input_urls", label: "تصاویر ورودی (اختیاری)", max: 2 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219] },
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
      { kind: "segment", key: "mode", label: "کیفیت", def: "pro", options: [
        { value: "std", label: "720p" }, { value: "pro", label: "1080p" }, { value: "4K", label: "4K" },
      ] },
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
      { id: "kling-3", model: "kling-3.0/video", label: "۳٫۰" },
      {
        // Turbo exposes neither sound nor multi_shots, and tops out at 1080p, so
        // it can't inherit the family controls. aspect_ratio exists on the
        // text-to-video model only — with an input image the frame comes from the
        // image, so the backend must drop aspect_ratio when it calls image-to-video.
        id: "kling-3-turbo",
        model: "kling/v3-turbo-text-to-video",
        modelWithRefs: "kling/v3-turbo-image-to-video",
        label: "۳٫۰ Turbo",
        badge: "سریع",
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          { kind: "segment", key: "resolution", label: "کیفیت", def: "720p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
          { kind: "slider", key: "duration", label: "مدت", min: 3, max: 15, step: 1, def: 5, unit: "ثانیه" },
        ],
      },
      {
        id: "kling-2-6",
        model: "kling-2.6/text-to-video",
        modelWithRefs: "kling-2.6/image-to-video",
        label: "۲٫۶",
        // Not the family slot: 2.6 takes one source image, not a start/end frame
        // pair. Its image-to-video model also drops aspect_ratio — the frame comes
        // from the image — so the backend must omit that field when an image is set.
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
          { kind: "toggle", key: "sound", label: "تولید صدا", def: false },
        ],
      },
      {
        id: "kling-2-5-turbo",
        model: "kling/v2-5-turbo-text-to-video-pro",
        modelWithRefs: "kling/v2-5-turbo-image-to-video-pro",
        label: "۲٫۵ Turbo",
        // The image-to-video model names its frames separately — image_url and
        // tail_image_url — instead of one image_urls array, and drops
        // aspect_ratio, which follows the start frame.
        refs: [
          { key: "image_url", label: "فریم شروع (اختیاری)", max: 1 },
          { key: "tail_image_url", label: "فریم پایان", max: 1, requires: "image_url" },
        ],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          { kind: "slider", key: "cfg_scale", label: "پایبندی به پرامپت", min: 0, max: 1, step: 0.1, def: 0.5, advanced: true },
        ],
      },
    ],
  },
  {
    id: "wan",
    name: "Wan",
    maxPrompt: 5000, // 2.6, 2.7 and R2V — but 2.5 is far tighter, see below
    vendor: "Alibaba",
    kind: "video",
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
      { kind: "segment", key: "resolution", label: "کیفیت", def: "720p", options: [
        { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
      ] },
      { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
        { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
      ] },
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
        model: "wan/2-5-text-to-video",
        modelWithRefs: "wan/2-5-image-to-video",
        maxPrompt: 800, // tightest in the catalog — a detailed prompt passes it easily
        label: "۲٫۵",
        refs: [{ key: "image_url", label: "تصویر ورودی (اختیاری)", max: 1 }],
      },
      {
        id: "wan-2-6",
        model: "wan/2-6-text-to-video",
        modelWithRefs: "wan/2-6-image-to-video",
        label: "۲٫۶",
        // 2.6 has no aspect/ratio field and no negative_prompt, unlike 2.7 — so it
        // must not inherit the family controls. It had no upload slot at all,
        // which left its image-to-video model unreachable.
        refs: [{ key: "image_urls", label: "تصویر ورودی (اختیاری)", max: 1 }],
        controls: [
          { kind: "segment", key: "resolution", label: "کیفیت", def: "1080p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" }, { value: "15", label: "۱۵ ثانیه" },
          ] },
          { kind: "toggle", key: "multi_shots", label: "چندنما (روایت چندبخشی)", def: false, advanced: true },
        ],
      },
      {
        id: "wan-2-7",
        model: "wan/2-7-text-to-video",
        modelWithRefs: "wan/2-7-image-to-video",
        label: "۲٫۷",
        // Note the field is `ratio` here, not `aspect_ratio` as everywhere else,
        // and the image-to-video model drops it entirely — the frame follows the
        // first image. It also accepts first_clip_url (video) and
        // driving_audio_url (audio), which the uploader can't offer yet.
        refs: [
          { key: "first_frame_url", label: "فریم شروع (اختیاری)", max: 1 },
          { key: "last_frame_url", label: "فریم پایان (اختیاری)", max: 1 },
        ],
        controls: [
          { kind: "aspect", key: "ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34] },
          { kind: "segment", key: "resolution", label: "کیفیت", def: "1080p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
          { kind: "slider", key: "duration", label: "مدت", min: 2, max: 15, step: 1, def: 5, unit: "ثانیه" },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
          // API default is true; kept on to match, but now visible and switchable.
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
        model: "wan/2-7-r2v",
        label: "۲٫۷ مرجع",
        refs: [
          { key: "reference_image", label: "تصاویر مرجع (الزامی)", max: 5, required: true },
          { key: "first_frame", label: "فریم شروع (اختیاری)", max: 1 },
        ],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34] },
          { kind: "segment", key: "resolution", label: "کیفیت", def: "1080p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
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
        model: "hailuo/2-3-image-to-video-pro",
        label: "۲٫۳ Pro",
        refs: [{ key: "image_url", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
        controls: hailuo23Controls,
      },
      {
        id: "hailuo-2-3-standard",
        model: "hailuo/2-3-image-to-video-standard",
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
      { kind: "segment", key: "duration", label: "مدت", def: "8", options: [
        { value: "4", label: "۴ ثانیه" }, { value: "6", label: "۶ ثانیه" },
        { value: "8", label: "۸ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
      ] },
    ],
    variants: [{ id: "gemini-omni-video", model: "gemini-omni-video", label: "Omni" }],
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
    blurb: "پرچم‌دارِ ویدیوی گوگل؛ کیفیت سینمایی و صدا",
    badge: "جدید",
    grad: "linear-gradient(135deg,#0ea5e9,#6366f1)",
    cover: "https://file.aiquickdraw.com/custom-page/akr/section-images/1760692238600spjz047p.mp4",
    refs: [{ key: "imageUrls", label: "تصاویر مرجع / فریم (اختیاری)", max: 2 }],
    controls: [
      { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916] },
      QUALITY("720p", ["720p", "1080p", "4k"]),
      { kind: "segment", key: "duration", label: "مدت", def: "8", options: [
        { value: "4", label: "۴ ثانیه" }, { value: "6", label: "۶ ثانیه" }, { value: "8", label: "۸ ثانیه" },
      ] },
    ],
    variants: [
      { id: "veo-fast", model: "veo3_fast", label: "سریع", badge: "ارزان" },
      { id: "veo-quality", model: "veo3", label: "کیفیت", badge: "پرچم‌دار" },
      { id: "veo-lite", model: "veo3_lite", label: "Lite" },
    ],
  },
  {
    id: "grok-image",
    name: "Grok Imagine",
    vendor: "xAI",
    kind: "image",
    blurb: "تصویرسازِ سریعِ xAI",
    badge: "xAI",
    grad: "linear-gradient(135deg,#3b3f46,#1c1f24)",
    controls: [
      { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "1:1", options: [ratios.sq, ratios.p23, ratios.l32, ratios.l169, ratios.p916] },
      { kind: "toggle", key: "enable_pro", label: "حالت کیفیت", def: false },
    ],
    variants: [{ id: "grok-image", model: "grok-imagine/text-to-image", label: "Imagine" }],
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
        model: "elevenlabs/text-to-speech-turbo-2-5",
        label: "Turbo",
        badge: "ارزان",
        controls: [
          ...elevenCommonControls,
          { kind: "segment", key: "language_code", label: "زبان", def: "", advanced: true, options: [
            { value: "", label: "خودکار" }, { value: "fa", label: "فارسی" }, { value: "en", label: "انگلیسی" }, { value: "ar", label: "عربی" },
          ] },
        ],
      },
      { id: "eleven-multilingual", model: "elevenlabs/text-to-speech-multilingual-v2", label: "چندزبانه", badge: "کیفیت" },
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
      { kind: "segment", key: "upscale_factor", label: "بزرگ‌نمایی", def: "2", options: [
        { value: "2", label: "۲ برابر" }, { value: "4", label: "۴ برابر" }, { value: "8", label: "۸ برابر" },
      ] },
    ],
    variants: [{ id: "topaz-image-upscale", model: "topaz/image-upscale", label: "بزرگ‌نمایی" }],
  },
  {
    id: "recraft",
    name: "Recraft",
    vendor: "Recraft",
    kind: "image",
    blurb: "بزرگ‌نمایی سریع و حذف پس‌زمینه",
    badge: "ابزار",
    grad: "linear-gradient(135deg,#a78bfa,#4c1d95)",
    noPrompt: true,
    // Note the field is `image` here, where Topaz calls the same thing image_url.
    refs: [{ key: "image", label: "تصویر ورودی (الزامی)", max: 1, required: true }],
    controls: [],
    variants: [
      { id: "recraft-crisp-upscale", model: "recraft/crisp-upscale", label: "بزرگ‌نمایی", badge: "ارزان" },
      { id: "recraft-remove-bg", model: "recraft/remove-background", label: "حذف پس‌زمینه" },
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

/** Default input object from a control list, ready to send to KIE. */
export function defaultInput(controls: Control[]): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const c of controls) {
    if (c.kind === "aspect" || c.kind === "segment") out[c.key] = c.def;
    else if (c.kind === "slider") out[c.key] = c.asString ? String(c.def) : c.def;
    else if (c.kind === "toggle") out[c.key] = c.def;
  }
  return out;
}
