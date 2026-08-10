// The prompt bank — a named vocabulary for describing a shot.
//
// Their Academy carries this under the courses, and it is the more useful half.
// A course teaches you to make one thing; the bank teaches you the words, which
// is what someone actually lacks at 2am with a blank prompt box. "Rack focus"
// and "dolly zoom" are craft terms with exact meanings that the models were
// trained on — knowing the term IS the skill.
//
// Every entry is a FRAGMENT, not a whole prompt. It appends to whatever the user
// has already written rather than replacing it, because these compose: a camera
// move, a lighting setup and a lens are three independent choices about one
// shot. Presets (data/presets.ts) are the opposite — complete prompts you start
// from. Both belong; they are not versions of each other.
//
// The fragments stay in English. The models were trained on English craft terms
// and a Persian translation of "rack focus" is not a term any of them know; the
// Persian label is what the user reads, the English is what the model gets.
// This is the one place in the app where showing Latin text to the user is the
// correct answer rather than a gap in the localisation.
//
// ContentRecord because an admin will add to this far more often than to any
// other collection — see data/content.ts. Read through `published()`.

import type { ContentRecord } from "./content";

export type BankCategory = "camera" | "lighting" | "lens" | "motion" | "grade";

export const BANK_LABEL: Record<BankCategory, string> = {
  camera: "حرکت دوربین",
  lighting: "نورپردازی",
  lens: "لنز و قاب",
  motion: "حرکت سوژه",
  grade: "رنگ و حال‌وهوا",
};

/** What each group is for, in one line — the bank is a reference, and a
 *  reference with no orientation is just a word list. */
export const BANK_BLURB: Record<BankCategory, string> = {
  camera: "دوربین چطور حرکت می‌کند. مهم‌ترین انتخاب در یک نمای ویدیویی.",
  lighting: "نور از کجا می‌آید. بیشترین تأثیر را روی حس تصویر دارد.",
  lens: "چقدر نزدیک، با چه عمق میدانی، در چه قابی.",
  motion: "سوژه چه می‌کند — جدا از اینکه دوربین چه می‌کند.",
  grade: "رنگ، کنتراست و دوره‌ی زمانی‌ای که تصویر را تداعی می‌کند.",
};

export interface BankEntry extends ContentRecord {
  /** What the user reads. */
  label: string;
  /** What the model gets. English on purpose — see the note at the top. */
  fragment: string;
  category: BankCategory;
  /** One line on when to reach for it. */
  note: string;
}

const T = Date.UTC(2026, 7, 1);
let seq = 0;
const e = (id: string, category: BankCategory, label: string, fragment: string, note: string): BankEntry => ({
  id,
  category,
  label,
  fragment,
  note,
  order: (seq += 10),
  status: "published",
  updatedAt: T,
});

export const PROMPT_BANK: BankEntry[] = [
  // Camera — the list theirs leads with, because on a video model this is the
  // single choice that changes the result most.
  e("c1", "camera", "نمای ثابت", "static shot, locked-off camera, no movement", "وقتی خود سوژه به‌اندازه‌ی کافی حرکت دارد."),
  e("c2", "camera", "پن به راست", "smooth pan right, tripod-mounted", "برای نشان دادن عرض یک فضا."),
  e("c3", "camera", "تیلت رو به بالا", "slow tilt up, revealing", "ارتفاع را بزرگ نشان می‌دهد — ساختمان، درخت، آدم."),
  e("c4", "camera", "زوم آهسته به داخل", "slow push in, subtle zoom toward the subject", "توجه را جمع می‌کند. کلیشه‌ای اما همیشه کار می‌کند."),
  e("c5", "camera", "دالی زوم", "dolly zoom, vertigo effect, background warping", "حس اضطراب و ناپایداری. کم استفاده کن."),
  e("c6", "camera", "دالی به داخل", "dolly in, camera physically moving forward, steady", "مثل زوم اما پرسپکتیو عوض می‌شود — طبیعی‌تر است."),
  e("c7", "camera", "مدار دور سوژه", "orbiting drone shot, circling the subject, smooth arc", "سوژه را قهرمان می‌کند. برای محصول و پرتره."),
  e("c8", "camera", "عقب‌کشیدن هوایی", "aerial pullback, rising and retreating, wide reveal", "پایان‌بندی. مقیاس را نشان می‌دهد."),
  e("c9", "camera", "کرین رو به بالا", "crane up, camera rising smoothly above eye level", "از صحنه فاصله می‌گیرد بدون اینکه رهایش کند."),
  e("c10", "camera", "دوربین روی دست", "handheld, subtle camera shake, documentary feel", "واقع‌گرایی. برای صحنه‌های تنش‌دار."),
  e("c11", "camera", "تعقیب از پشت", "tracking shot following behind the subject, steadicam", "بیننده را همراه سوژه می‌کند."),

  // Lighting
  e("l1", "lighting", "نور طلایی غروب", "golden hour lighting, warm low sun, long soft shadows", "بی‌خطرترین نور. تقریباً همه‌چیز را بهتر می‌کند."),
  e("l2", "lighting", "کنتراست شدید", "high contrast chiaroscuro lighting, deep shadows, single hard source", "دراماتیک. جزئیات را در سایه از دست می‌دهی."),
  e("l3", "lighting", "نور نرم پخش", "soft diffused lighting, large softbox, even and shadowless", "برای پرتره و محصول. تمیز و بی‌ادعا."),
  e("l4", "lighting", "نور پس‌زمینه", "backlit, rim light separating subject from background, glowing edge", "سوژه را از پس‌زمینه جدا می‌کند."),
  e("l5", "lighting", "نئون شبانه", "neon night lighting, magenta and cyan practical lights, wet reflective ground", "سایبرپانک. با شهر و باران بهترین است."),
  e("l6", "lighting", "نور تک‌منبع پنجره", "single window light, natural, soft falloff to shadow", "صمیمی و آرام. برای صحنه‌های داخلی."),
  e("l7", "lighting", "مه و پرتو نور", "volumetric light rays through haze, god rays, atmospheric fog", "عمق می‌سازد. نور را دیدنی می‌کند."),

  // Lens & framing
  e("n1", "lens", "کلوزآپ", "extreme close-up, shallow depth of field", "برای احساس. صورت، دست، جزئیات."),
  e("n2", "lens", "نمای متوسط", "medium shot, waist up, natural perspective", "پیش‌فرض امن برای آدم‌ها."),
  e("n3", "lens", "نمای باز", "wide establishing shot, subject small in frame", "جایی که هستیم را می‌گوید."),
  e("n4", "lens", "عمق میدان کم", "shot on 85mm, f/1.4, creamy bokeh, background melted", "پس‌زمینه‌ی شلوغ را حل می‌کند."),
  e("n5", "lens", "لنز واید", "shot on 24mm wide-angle lens, slight distortion, immersive", "فضا را بزرگ‌تر نشان می‌دهد."),
  e("n6", "lens", "آنامورفیک", "anamorphic lens, 2.39:1, horizontal lens flares, oval bokeh", "حس سینمای اکران."),
  e("n7", "lens", "زاویه‌ی پایین", "low angle shot, camera below eye level, looking up", "سوژه را قدرتمند نشان می‌دهد."),
  e("n8", "lens", "نمای از بالا", "top-down overhead shot, flat lay perspective", "برای محصول، غذا، و نقشه‌ی صحنه."),

  // Subject motion
  e("m1", "motion", "حرکت آهسته", "slow motion, 120fps, fluid and weighted", "جزئیات حرکت را دیدنی می‌کند."),
  e("m2", "motion", "چرخش آرام محصول", "product rotating slowly on a turntable, seamless loop", "استاندارد ویترین محصول."),
  e("m3", "motion", "پارچه در باد", "fabric billowing in slow wind, natural cloth simulation", "حرکت بدون اینکه سوژه جا عوض کند."),
  e("m4", "motion", "قدم‌زدن به سمت دوربین", "subject walking toward camera, confident steady pace", "معرفی شخصیت."),
  e("m5", "motion", "ذرات معلق", "dust particles floating in the air, catching the light", "فضا را زنده می‌کند. با نور پس‌زمینه عالی است."),

  // Grade & mood
  e("g1", "grade", "سینمایی سرد", "cinematic color grade, teal shadows, orange highlights", "پرکاربردترین گرید سینمای امروز."),
  e("g2", "grade", "فیلم ۳۵ میلی‌متری", "shot on 35mm film, visible grain, halation, Kodak Portra palette", "گرمای آنالوگ. نقص‌هایش عمدی است."),
  e("g3", "grade", "دهه‌ی هفتاد", "1970s film stock, faded warm tones, soft contrast", "نوستالژی بدون اینکه کهنه به‌نظر برسد."),
  e("g4", "grade", "سیاه‌وسفید پرکنتراست", "high contrast black and white, deep blacks, silver gelatin print", "وقتی رنگ حواس را پرت می‌کند."),
  e("g5", "grade", "روشن و تمیز", "bright airy clean look, low contrast, pastel palette", "برای تبلیغات و لایف‌استایل."),
  e("g6", "grade", "تاریک و دلگیر", "desaturated moody grade, cold blue cast, heavy shadows", "تریلر و درام."),
];
