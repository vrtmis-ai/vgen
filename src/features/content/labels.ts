import type { Course } from "../../runtime/contracts/content";

/**
 * The words for the one vocabulary the schema still fixes, and the two
 * derivations a screen makes over a row.
 *
 * A course's level is three ordered steps the site sorts by, so it stays an
 * enum with its labels here. The effects wall's shelves and the prompt bank's
 * used to keep their words here too, on the argument that a category is not
 * free text — and that argument lost: adding a shelf was a deploy. They are
 * rows now (migration 0034) and screens read them through `useShelves` in
 * `categories.ts`.
 *
 * `voicePreviewUrl` is here for the original reason: it is a URL template
 * belonging to a provider's static host, not a fact about any one voice.
 */

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
