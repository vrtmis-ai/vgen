import { z } from "zod";

/**
 * The editorial content the product is made of, as the screens see it.
 *
 * Seven collections that lived as TypeScript constants in `src/data` until
 * `content_items` (migration 0020). They share one table and one route because
 * an admin thinks about them the same way — publish it, order it, pull it — but
 * they arrive here as seven typed arrays rather than one kind-tagged list, so a
 * screen that wants courses gets courses and not a filter it has to write.
 *
 * WHAT IS DELIBERATELY ABSENT: `updatedAt` and `updatedBy`. Both exist on the
 * row and neither belongs in the payload every visitor downloads — nobody
 * browsing effects needs to know which admin last touched one. They are read
 * through the admin route instead. Leaving them out also keeps the committed
 * demo snapshot stable: a per-row timestamp would change on every re-seed and
 * the CI diff that proves the round trip still works would stop meaning
 * anything.
 */

/** Draft, published, archived. On the row and on the admin route — never here; see below. */
export const ContentStatusSchema = z.enum(["draft", "published", "archived"]);

/**
 * What every collection carries, which is less than it looks.
 *
 * No `status` and no `order`. Both exist on the row, and neither survives to
 * the customer: this route serves published rows already in the admin's order,
 * so `status` could only ever read "published" and `order` could only ever
 * agree with the array index. `src/data/content.ts` exported a `published()`
 * helper that every screen had to remember to call, and forgetting it showed a
 * draft to a customer. Doing the filter in SQL means a screen cannot forget.
 */
const ItemSchema = z.object({
  /** The stable code the screens key off — `p1`, `c-start`, a voice's own id. */
  id: z.string().min(1),
});

/** A complete prompt behind a picture. Tapping one opens its family, pre-filled. */
export const PresetSchema = ItemSchema.extend({
  title: z.string().min(1),
  familyId: z.string().min(1),
  seed: z.string().min(1),
  prompt: z.string().min(1),
  /**
   * The prompt ends mid-sentence and expects the user's subject appended.
   * Not cosmetic: it decides whether the surface drops the caret at the end or
   * replaces the text, and getting it backwards silently deletes what they typed.
   */
  openEnded: z.boolean(),
  kind: z.enum(["video", "image"]),
  category: z.enum(["camera", "transform", "vfx", "portrait", "product"]),
  badge: z.string().min(1).optional(),
});

/**
 * A craft term that appends to whatever the user has already written.
 *
 * `fragment` stays English on purpose — the models were trained on "rack focus"
 * and know nothing by its Persian translation. `label` is what the user reads.
 */
export const PromptFragmentSchema = ItemSchema.extend({
  label: z.string().min(1),
  fragment: z.string().min(1),
  category: z.enum(["camera", "lighting", "lens", "motion", "grade"]),
  note: z.string().min(1),
});

/** A multi-step workflow: several families run in sequence behind one button. */
export const SkillSchema = ItemSchema.extend({
  title: z.string().min(1),
  blurb: z.string().min(1),
  seed: z.string().min(1),
  /** Roughly what one run costs. Absent until the steps are priced. */
  coins: z.number().int().positive().optional(),
  steps: z
    .array(
      z.object({
        label: z.string().min(1),
        familyId: z.string().min(1).optional(),
      }),
    )
    .min(1),
});

/** The curated shelf: a model drop, a feature launch, or a ready-made template. */
export const FeaturedItemSchema = ItemSchema.extend({
  kind: z.enum(["model", "template", "feature"]),
  title: z.string().min(1),
  subtitle: z.string().min(1),
  seed: z.string().min(1),
  familyId: z.string().min(1).optional(),
  /** Templates only: what the user appends their subject to. */
  prompt: z.string().min(1).optional(),
});

export const LessonSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Whole seconds. Rendered mm:ss, Latin digits, tabular. */
  seconds: z.number().int().positive(),
  /** Absent until the video is uploaded — the row still lists, greyed. */
  videoUrl: z.url().optional(),
});

/**
 * A course. There is no price field and that is the owner's decision rather
 * than an omission: courses are free, always, so a priced course must not parse.
 */
export const CourseSchema = ItemSchema.extend({
  title: z.string().min(1),
  blurb: z.string().min(1),
  seed: z.string().min(1),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  familyId: z.string().min(1).optional(),
  lessons: z.array(LessonSchema).min(1),
});

/** An example output. Tapping it opens its model with the prompt pre-filled. */
export const ExampleSchema = ItemSchema.extend({
  familyId: z.string().min(1),
  prompt: z.string().min(1),
  seed: z.string().min(1),
  /** Aspect ratio as two integers, so the grid can reserve the box before the image lands. */
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

/**
 * An ElevenLabs voice, as listed in KIE's text-to-speech spec.
 *
 * Reference data rather than something an admin writes — `id` is the provider's
 * own voice id and the preview URL is derived from it. It lives here anyway
 * because the one thing an admin genuinely needs over it is the ability to hide
 * one, and that is `status` on a row rather than a new table.
 */
export const VoiceSchema = ItemSchema.extend({
  name: z.string().min(1),
  note: z.string().min(1),
});

export const ContentSnapshotSchema = z.object({
  /** Derived from the newest row's updated_at — a client holding an older one knows it is stale. */
  version: z.string().min(1),
  publishedAt: z.number().int().nonnegative(),
  /**
   * Switches the browser can read before it has a session.
   *
   * This rides on the content document rather than getting a route of its own,
   * and the reason is first paint. The layout already blocks on `GET /content`
   * for every visitor including anonymous ones, so a flag here costs no extra
   * request and no flash of something that should have been off. A dedicated
   * endpoint would arrive after the first render and the banner would appear
   * and then vanish, which is worse than either state on its own.
   *
   * Not in `content.snapshot.json`. The snapshot is the seven collections, and
   * a flag is not content — it is a runtime switch whose value at export time
   * says nothing about its value now. `version` and `publishedAt` are left out
   * of that file for the same reason, and the CI check that counts the served
   * rows sums `.length` over every key it finds, so a non-array top-level entry
   * would quietly make that arithmetic `NaN`.
   */
  flags: z.object({
    /**
     * Whether the announcement strip renders at all. Defaults to on: an absent
     * or deleted row means nobody has turned it off, and a campaign that
     * silently stops being advertised costs a sale, where a strip that outstays
     * its welcome costs a click on the dismiss button.
     */
    siteBanner: z.boolean(),
  }),
  presets: z.array(PresetSchema),
  fragments: z.array(PromptFragmentSchema),
  skills: z.array(SkillSchema),
  featured: z.array(FeaturedItemSchema),
  courses: z.array(CourseSchema),
  examples: z.array(ExampleSchema),
  voices: z.array(VoiceSchema),
});

export type ContentStatus = z.infer<typeof ContentStatusSchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type PromptFragment = z.infer<typeof PromptFragmentSchema>;
export type ContentSkill = z.infer<typeof SkillSchema>;
export type FeaturedItem = z.infer<typeof FeaturedItemSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Voice = z.infer<typeof VoiceSchema>;
export type ContentSnapshot = z.infer<typeof ContentSnapshotSchema>;
