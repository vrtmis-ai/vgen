import type { Course, Preset, PromptFragment } from "../../runtime/contracts/content";

/**
 * How the content's enums are written in Persian, and the two derivations a
 * screen makes over a row.
 *
 * These stayed in code when the seven collections moved to Postgres, and the
 * line is worth stating: `content_items` holds the rows an admin publishes, and
 * this file holds the words the interface uses for the fixed vocabulary those
 * rows are typed against. A category is not free text — it is one of five
 * values the schema enforces — so its label belongs beside the enum rather than
 * in a table where it could go missing and leave a tab with no name.
 *
 * `voicePreviewUrl` is here for the same reason: it is a URL template belonging
 * to a provider's static host, not a fact about any one voice.
 */

export const CATEGORY_LABEL: Record<Preset["category"], string> = {
  camera: "دوربین",
  transform: "دگرگونی",
  vfx: "جلوه‌ی ویژه",
  portrait: "پرتره",
  product: "محصول",
};

export const BANK_LABEL: Record<PromptFragment["category"], string> = {
  camera: "حرکت دوربین",
  lighting: "نورپردازی",
  lens: "لنز و قاب",
  motion: "حرکت سوژه",
  grade: "رنگ و حال‌وهوا",
};

export const BANK_BLURB: Record<PromptFragment["category"], string> = {
  camera: "دوربین چطور حرکت می‌کند. مهم‌ترین انتخاب در یک نمای ویدیویی.",
  lighting: "نور از کجا می‌آید. بیشترین تأثیر را روی حس تصویر دارد.",
  lens: "چقدر نزدیک، با چه عمق میدانی، در چه قابی.",
  motion: "سوژه چه می‌کند — جدا از اینکه دوربین چه می‌کند.",
  grade: "رنگ، کنتراست و دوره‌ی زمانی‌ای که تصویر را تداعی می‌کند.",
};

export const LEVEL_LABEL: Record<Course["level"], string> = {
  beginner: "مقدماتی",
  intermediate: "متوسط",
  advanced: "پیشرفته",
};

/** Whole minutes of video in a course, rounded. Shown on the card. */
export function courseMinutes(course: Course): number {
  return Math.round(course.lessons.reduce((total, lesson) => total + lesson.seconds, 0) / 60);
}

/**
 * Public preview clip for a voice. No auth, no cost.
 *
 * KIE publishes no endpoint to enumerate voices, but it does document a preview
 * per voice at this predictable URL — verified reachable and returning
 * audio/mpeg — which is what makes choosing by ear possible without generating
 * (and paying for) a sample first.
 */
export function voicePreviewUrl(id: string): string {
  return `https://static.aiquickdraw.com/elevenlabs/voice/${id}.mp3`;
}
