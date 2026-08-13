// Skills — multi-step workflows you write once and run every time.
//
// The owner's plan puts these alongside MCP rather than on their own nav item:
// both answer "use VGen from somewhere other than the website", and splitting
// them made two "coming soon" tiles sitting next to each other saying nothing.
//
// ContentRecord because a skill is content an admin publishes, not code we
// ship — the same rule as effects and courses. See data/content.ts.

import type { ContentRecord } from "./content";

export interface SkillStep {
  /** What this step does, in the user's words. */
  label: string;
  /** Which family runs it, when a step maps to one. */
  familyId?: string | undefined;
}

export interface Skill extends ContentRecord {
  title: string;
  blurb: string;
  seed: string;
  /** Roughly what one run costs, in coins. Null until the steps are priced. */
  coins?: number | undefined;
  steps: SkillStep[];
}

const T = Date.UTC(2026, 7, 1);

export const SKILLS: Skill[] = [
  {
    id: "s-ugc",
    status: "published",
    order: 10,
    updatedAt: T,
    title: "ویدیوی معرفی محصول",
    blurb: "از یک عکس محصول تا یک ویدیوی کوتاه با گویندهٔ فارسی — سه مرحله، یک دکمه.",
    seed: "vgen-skill-ugc",
    coins: 210,
    steps: [
      { label: "پاک‌کردن پس‌زمینهٔ عکس محصول", familyId: "recraft" },
      { label: "ساخت صحنه‌ی استودیویی دور محصول", familyId: "seedream" },
      { label: "متحرک‌کردن صحنه", familyId: "seedance" },
      { label: "افزودن گویندگی فارسی", familyId: "elevenlabs" },
    ],
  },
  {
    id: "s-reel",
    status: "published",
    order: 20,
    updatedAt: T,
    title: "ریلز از یک متن",
    blurb: "متن را بده؛ سه پلان، گویندگی و زیرنویس فارسی بیرون می‌آید.",
    seed: "vgen-skill-reel",
    coins: 340,
    steps: [
      { label: "تقسیم متن به سه پلان" },
      { label: "ساخت هر پلان", familyId: "seedance" },
      { label: "گویندگی روی کل متن", familyId: "elevenlabs" },
    ],
  },
  {
    id: "s-portrait",
    status: "published",
    order: 30,
    updatedAt: T,
    title: "پرتره‌ی حرفه‌ای",
    blurb: "یک سلفی بده، ده پرتره‌ی استودیویی با نور و زاویه‌های مختلف بگیر.",
    seed: "vgen-skill-portrait",
    coins: 90,
    steps: [
      { label: "پاک‌سازی و بزرگ‌نمایی ورودی", familyId: "topaz" },
      { label: "ساخت ده نسخه با نورپردازی‌های متفاوت", familyId: "nano-banana" },
    ],
  },
  {
    id: "s-ad",
    status: "draft",
    order: 40,
    updatedAt: T,
    title: "تیزر تبلیغاتی ۱۵ ثانیه‌ای",
    blurb: "بریف را بده، تیزر با موسیقی تحویل بگیر.",
    seed: "vgen-skill-ad",
    steps: [{ label: "در دست ساخت" }],
  },
];
