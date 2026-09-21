import { useReducedMotion } from "framer-motion";
import type { Course, Preset } from "../../runtime/contracts/content";

const picsum = (seed: string, w: number, h: number) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

/**
 * An admin's upload, as a browser can fetch it.
 *
 * Rows keep `/api/v1/content/media/<file>`, relative to the API — see
 * `MediaRefSchema`. In production the API shares the site's origin and this
 * changes nothing; locally it runs on another port, and an unresolved path
 * would ask the web server for every cover and get a 404.
 */
export function mediaSrc(ref: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!ref.startsWith("/") || !base) return ref;
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

/** An effect's picture: the cover an admin uploaded, else placeholder art from its seed. */
export const presetArt = (preset: Preset, w = 480, h = 640): string =>
  preset.coverUrl ? mediaSrc(preset.coverUrl) : picsum(preset.seed, w, h);

/** A course's still: its cover picture, else placeholder art. A video cover is drawn by `CourseCover`. */
export const courseArt = (course: Course, w = 800, h = 450): string =>
  course.cover?.kind === "image" ? mediaSrc(course.cover.url) : picsum(course.seed, w, h);

/**
 * A course's cover, picture or video.
 *
 * A video is a muted inline loop — the only kind a browser will autoplay, and
 * inline so a phone does not take it full screen. It does not play for someone
 * who asked for reduced motion; they get its first frame.
 */
export function CourseCover({ course, className }: { course: Course; className?: string }) {
  const still = useReducedMotion() ?? false;
  if (course.cover?.kind === "video") {
    return (
      <video
        src={mediaSrc(course.cover.url)}
        muted
        loop
        playsInline
        autoPlay={!still}
        preload="metadata"
        aria-hidden
        className={className}
      />
    );
  }
  return <img src={courseArt(course)} alt="" loading="lazy" className={className} />;
}
