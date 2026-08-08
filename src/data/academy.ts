// VGen Academy — courses for learning the models, in Persian.
//
// The reference runs this as its own nav item, and the reason is not education
// for its own sake: a user who cannot write a prompt does not convert, and no
// amount of catalog fixes that. A course is the slowest, stickiest version of
// the same job the presets grid does quickly.
//
// Shaped as ContentRecord from day one because this is exactly the collection
// an admin will be adding to weekly, and none of it should require a deploy.

import type { ContentRecord } from "./content";

export type CourseLevel = "beginner" | "intermediate" | "advanced";

export interface Lesson {
  id: string;
  title: string;
  /** Whole seconds. Rendered as mm:ss, Latin digits, tabular. */
  seconds: number;
  /** Absent until the video is uploaded — the row still lists, greyed. */
  videoUrl?: string | undefined;
}

export interface Course extends ContentRecord {
  title: string;
  blurb: string;
  seed: string;
  level: CourseLevel;
  /** Free courses carry no price; the rest cost coins like anything else. */
  coins?: number | undefined;
  /** Which model family the course teaches, when it teaches one. */
  familyId?: string | undefined;
  lessons: Lesson[];
}

export const LEVEL_LABEL: Record<CourseLevel, string> = {
  beginner: "مقدماتی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

const T = Date.UTC(2026, 7, 1);

export const COURSES: Course[] = [
  {
    id: "c-start", status: "published", order: 10, updatedAt: T,
    title: "از صفر تا اولین ویدیو",
    blurb: "اگر تا حالا با هوش مصنوعی چیزی نساخته‌ای، از اینجا شروع کن. در چهل دقیقه اولین ویدیوی خودت را می‌سازی.",
    seed: "vgen-course-start", level: "beginner",
    lessons: [
      { id: "l1", title: "اینجا چه خبر است؟ مدل، پرامپت، سکه", seconds: 420 },
      { id: "l2", title: "اولین پرامپت: چه بنویسیم و چه ننویسیم", seconds: 610 },
      { id: "l3", title: "نسبت تصویر، مدت، کیفیت — کدام چقدر خرج دارد", seconds: 505 },
      { id: "l4", title: "اولین ویدیو، از اول تا آخر", seconds: 890 },
    ],
  },
  {
    id: "c-prompt", status: "published", order: 20, updatedAt: T,
    title: "پرامپت‌نویسی برای ویدیو",
    blurb: "نور، لنز، حرکت دوربین، ریتم برش. زبانی که مدل‌های ویدیو واقعاً می‌فهمند.",
    seed: "vgen-course-prompt", level: "intermediate", coins: 120,
    lessons: [
      { id: "l1", title: "ساختار یک پرامپت خوب", seconds: 730 },
      { id: "l2", title: "واژگان دوربین: دالی، تراک، کرین، هندهلد", seconds: 845 },
      { id: "l3", title: "نور را چطور توصیف کنیم", seconds: 690 },
      { id: "l4", title: "چرا خروجی‌ات شبیه تبلیغ استوک است", seconds: 560 },
      { id: "l5", title: "تمرین: یک صحنه، پنج نسخه", seconds: 1120 },
    ],
  },
  {
    id: "c-seedance", status: "published", order: 30, updatedAt: T,
    title: "Seedance از پایه",
    blurb: "قوی‌ترین مدل ویدیوی کاتالوگ. صدای همزمان، صحنهٔ کامل، و جایی که کم می‌آورد.",
    seed: "vgen-course-seedance", level: "intermediate", familyId: "seedance", coins: 90,
    lessons: [
      { id: "l1", title: "تفاوت نسخه‌ها و اینکه کدام را کِی بزنی", seconds: 480 },
      { id: "l2", title: "صدای همزمان: چه وقت روشن، چه وقت خاموش", seconds: 615 },
      { id: "l3", title: "تصویر مرجع و ثبات شخصیت", seconds: 700 },
    ],
  },
  {
    id: "c-image", status: "published", order: 40, updatedAt: T,
    title: "تصویر: از Nano Banana تا Seedream",
    blurb: "کدام مدل برای پرتره، کدام برای محصول، کدام برای متن فارسی درست.",
    seed: "vgen-course-image", level: "beginner", coins: 60,
    lessons: [
      { id: "l1", title: "نقشهٔ مدل‌های تصویر", seconds: 520 },
      { id: "l2", title: "ویرایش با دستور متنی، بدون ماسک", seconds: 640 },
      { id: "l3", title: "متن فارسی روی تصویر — و چرا معمولاً خراب می‌شود", seconds: 580 },
    ],
  },
  {
    id: "c-voice", status: "published", order: 50, updatedAt: T,
    title: "گویندگی فارسی که مصنوعی نباشد",
    blurb: "انتخاب صدا، سرعت، مکث. و کارهایی که موتور نمی‌کند و باید خودت در متن بنویسی.",
    seed: "vgen-course-voice", level: "beginner", familyId: "elevenlabs", coins: 45,
    lessons: [
      { id: "l1", title: "کدام صدا برای کدام کار", seconds: 430 },
      { id: "l2", title: "نقطه‌گذاری، مکث، و لحن", seconds: 560 },
    ],
  },
  {
    id: "c-money", status: "published", order: 60, updatedAt: T,
    title: "با محتوای AI درآمد بساز",
    blurb: "از خروجی تا مشتری: قیمت‌گذاری، نمونه‌کار، و کارهایی که سفارش‌دهنده‌ی ایرانی واقعاً می‌خرد.",
    seed: "vgen-course-money", level: "advanced", coins: 180,
    lessons: [
      { id: "l1", title: "چه چیزی می‌فروشد و چه چیزی نه", seconds: 780 },
      { id: "l2", title: "قیمت‌گذاری وقتی هزینه‌ات سکه است", seconds: 690 },
      { id: "l3", title: "تحویل: فرمت، رزولوشن، بازنگری", seconds: 610 },
    ],
  },
  // Written but not filmed. Visible to a content admin, invisible to users.
  {
    id: "c-canvas", status: "draft", order: 70, updatedAt: T,
    title: "جریان‌های چندمرحله‌ای",
    blurb: "زنجیره‌کردن چند مدل پشت سر هم.",
    seed: "vgen-course-canvas", level: "advanced",
    lessons: [{ id: "l1", title: "مقدمه", seconds: 300 }],
  },
];

/** Total runtime, for the card. */
export function courseMinutes(c: Course): number {
  return Math.round(c.lessons.reduce((s, l) => s + l.seconds, 0) / 60);
}
