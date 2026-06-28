// Real KIE model catalog, grouped into families.
// A family (e.g. "Seedance") groups several real KIE models ("variants", e.g. v2 / fast / mini).
// Every `model` id and every control is grounded in docs.kie.ai + the live pricing table.
// See web/KIE_MODELS.md.

export type ModelKind = "image" | "video";

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
  | { kind: "text"; key: string; label: string; placeholder?: string; advanced?: boolean };

export interface RefSlot {
  key: string;
  label: string;
  max: number;
}

/** One concrete KIE model inside a family. */
export interface Variant {
  id: string; // our id (also the pricing key)
  model: string; // KIE createTask `model` field
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
  refs?: RefSlot[];
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
      options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219, ratios.adaptive],
    },
    QUALITY(res.includes("720p") ? "720p" : (res[0] ?? "720p"), res),
    { kind: "slider", key: "duration", label: "مدت", min: 4, max: 15, step: 1, def: 5, unit: "ثانیه" },
    { kind: "toggle", key: "generate_audio", label: "تولید صدا", def: true },
  ];
}

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
    vendor: "ByteDance",
    kind: "video",
    blurb: "ویدیوی واقع‌گرا با صدا؛ متن یا عکس به ویدیو",
    badge: "پرچم‌دار",
    grad: "linear-gradient(135deg,#4b6cf7,#9b4bf7)",
    refs: [
      { key: "first_frame_url", label: "فریم شروع (عکس‌به‌ویدیو)", max: 1 },
      { key: "last_frame_url", label: "فریم پایان (اختیاری)", max: 1 },
      { key: "reference_image_urls", label: "تصاویر مرجع / سوژه (اختیاری)", max: 9 },
    ],
    controls: seedanceControls(["480p", "720p", "1080p", "4k"]),
    variants: [
      { id: "seedance-2", model: "bytedance/seedance-2", label: "نسخه ۲", badge: "پرچم‌دار" },
      { id: "seedance-2-fast", model: "bytedance/seedance-2-fast", label: "سریع", controls: seedanceControls(["480p", "720p"]) },
      { id: "seedance-2-mini", model: "bytedance/seedance-2-mini", label: "مینی", badge: "ارزان", controls: seedanceControls(["480p", "720p"]) },
      {
        id: "seedance-1-5-pro",
        model: "bytedance/seedance-1.5-pro",
        label: "۱٫۵ Pro",
        refs: [{ key: "input_urls", label: "تصاویر ورودی (اختیاری)", max: 2 }],
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34, ratios.l219] },
          QUALITY("720p", ["480p", "720p", "1080p"]),
          { kind: "slider", key: "duration", label: "مدت", min: 4, max: 12, step: 1, def: 5, unit: "ثانیه" },
          { kind: "toggle", key: "generate_audio", label: "تولید صدا", def: false },
        ],
      },
    ],
  },
  {
    id: "kling",
    name: "Kling",
    vendor: "Kuaishou",
    kind: "video",
    blurb: "حرکت سینمایی و چندنما؛ تا ۱۵ ثانیه",
    badge: "سینمایی",
    grad: "linear-gradient(135deg,#f7c948,#f86a3b)",
    refs: [{ key: "image_urls", label: "فریم شروع و پایان (اختیاری)", max: 2 }],
    controls: [
      {
        kind: "aspect",
        key: "aspect_ratio",
        label: "نسبت تصویر",
        def: "16:9",
        options: [ratios.l169, ratios.p916, ratios.sq],
      },
      { kind: "segment", key: "mode", label: "کیفیت", def: "pro", options: [
        { value: "std", label: "استاندارد" }, { value: "pro", label: "حرفه‌ای" }, { value: "4K", label: "4K" },
      ] },
      { kind: "slider", key: "duration", label: "مدت", min: 3, max: 15, step: 1, def: 5, unit: "ثانیه", asString: true },
      { kind: "toggle", key: "sound", label: "تولید صدا", def: false },
      { kind: "toggle", key: "multi_shots", label: "چندنما (روایت چندبخشی)", def: false, advanced: true },
    ],
    variants: [
      { id: "kling-3", model: "kling-3.0/video", label: "۳٫۰" },
      {
        id: "kling-2-6",
        model: "kling-2.6/text-to-video",
        label: "۲٫۶",
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
        label: "۲٫۵ Turbo",
        controls: [
          { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq] },
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
        ],
      },
      {
        id: "kling-2-1",
        model: "kling/v2-1-pro",
        label: "۲٫۱",
        refs: [
          { key: "image_url", label: "فریم شروع (الزامی)", max: 1 },
          { key: "tail_image_url", label: "فریم پایان (اختیاری)", max: 1 },
        ],
        controls: [
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
        ],
      },
    ],
  },
  {
    id: "wan",
    name: "Wan",
    vendor: "Alibaba",
    kind: "video",
    blurb: "ویدیوی روان و اقتصادی",
    badge: "ارزان",
    grad: "linear-gradient(135deg,#ff5db1,#7b4dff)",
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
      { id: "wan-2-5", model: "wan/2-5-text-to-video", label: "۲٫۵" },
      {
        id: "wan-2-6",
        model: "wan/2-6-text-to-video",
        label: "۲٫۶",
        controls: [
          { kind: "segment", key: "resolution", label: "کیفیت", def: "1080p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
          { kind: "segment", key: "duration", label: "مدت", def: "5", options: [
            { value: "5", label: "۵ ثانیه" }, { value: "10", label: "۱۰ ثانیه" }, { value: "15", label: "۱۵ ثانیه" },
          ] },
        ],
      },
      {
        id: "wan-2-7",
        model: "wan/2-7-text-to-video",
        label: "۲٫۷",
        controls: [
          { kind: "aspect", key: "ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l43, ratios.p34] },
          { kind: "segment", key: "resolution", label: "کیفیت", def: "1080p", options: [
            { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" },
          ] },
          { kind: "slider", key: "duration", label: "مدت", min: 2, max: 15, step: 1, def: 5, unit: "ثانیه" },
          { kind: "text", key: "negative_prompt", label: "پرامپت منفی", placeholder: "چه چیزی نباشد…", advanced: true },
        ],
      },
    ],
  },
  {
    id: "hailuo",
    name: "Hailuo 02",
    vendor: "MiniMax",
    kind: "video",
    blurb: "حرکت طبیعی و چهره‌های واقعی",
    badge: "MiniMax",
    grad: "linear-gradient(135deg,#ee9ca7,#ffdde1)",
    controls: [{ kind: "toggle", key: "prompt_optimizer", label: "بهینه‌سازی پرامپت", def: true }],
    variants: [
      { id: "hailuo-02-pro", model: "hailuo/02-text-to-video-pro", label: "Pro" },
      {
        id: "hailuo-02-standard",
        model: "hailuo/02-text-to-video-standard",
        label: "۰۲ استاندارد",
        badge: "ارزان",
        controls: [
          { kind: "segment", key: "duration", label: "مدت", def: "6", options: [
            { value: "6", label: "۶ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
          { kind: "toggle", key: "prompt_optimizer", label: "بهینه‌سازی پرامپت", def: true },
        ],
      },
      {
        id: "hailuo-2-3",
        model: "hailuo/2-3-image-to-video-pro",
        label: "۲٫۳",
        refs: [{ key: "image_url", label: "تصویر ورودی (الزامی)", max: 1 }],
        controls: [
          { kind: "segment", key: "resolution", label: "کیفیت", def: "768P", options: [
            { value: "768P", label: "768p" }, { value: "1080P", label: "1080p" },
          ] },
          { kind: "segment", key: "duration", label: "مدت", def: "6", options: [
            { value: "6", label: "۶ ثانیه" }, { value: "10", label: "۱۰ ثانیه" },
          ] },
        ],
      },
    ],
  },
  // Veo uses a dedicated endpoint (POST /api/v1/veo/generate); `model` = veo3_fast|veo3|veo3_lite.
  {
    id: "veo",
    name: "Veo 3.1",
    vendor: "Google",
    kind: "video",
    blurb: "پرچم‌دارِ ویدیوی گوگل؛ کیفیت سینمایی و صدا",
    badge: "جدید",
    grad: "linear-gradient(135deg,#0ea5e9,#6366f1)",
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
  {
    id: "grok-video",
    name: "Grok Imagine",
    vendor: "xAI",
    kind: "video",
    blurb: "ویدیوسازِ سریعِ xAI؛ تا ۳۰ ثانیه",
    badge: "xAI",
    grad: "linear-gradient(135deg,#2b2f36,#14171c)",
    controls: [
      { kind: "aspect", key: "aspect_ratio", label: "نسبت تصویر", def: "16:9", options: [ratios.l169, ratios.p916, ratios.sq, ratios.l32, ratios.p23] },
      { kind: "segment", key: "resolution", label: "کیفیت", def: "480p", options: [
        { value: "480p", label: "480p" }, { value: "720p", label: "720p" },
      ] },
      { kind: "slider", key: "duration", label: "مدت", min: 6, max: 30, step: 1, def: 6, unit: "ثانیه" },
      { kind: "segment", key: "mode", label: "حالت", def: "normal", advanced: true, options: [
        { value: "fun", label: "شاد" }, { value: "normal", label: "عادی" }, { value: "spicy", label: "تند" },
      ] },
    ],
    variants: [{ id: "grok-video", model: "grok-imagine/text-to-video", label: "Imagine" }],
  },
];

export const IMAGE_FAMILIES = FAMILIES.filter((f) => f.kind === "image");
export const VIDEO_FAMILIES = FAMILIES.filter((f) => f.kind === "video");

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
