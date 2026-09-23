import { z } from "zod";

/**
 * The editorial content, as `GET /content` serves it.
 *
 * Deliberately a copy of `packages/contracts/src/content.ts` rather than an
 * import of it: this is the browser's statement of what it will accept, and
 * the server's is what it promises to send. They agree today, and the day they
 * stop agreeing the parse fails loudly here instead of a screen rendering a
 * field that quietly changed meaning.
 *
 * Seven collections that used to be TypeScript constants under `src/data`.
 * Nothing carries `status` or `order`: the route serves published rows already
 * in the admin's order, so the `published()` helper every screen had to
 * remember to call — and could forget — no longer exists to be forgotten.
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

/**
 * Where an admin's upload is served from.
 *
 * Normally `/api/v1/content/media/<file>`, relative to the API's origin: the
 * same row is read by production and by a laptop that restored its dump, and a
 * host baked into it would be right for only one of them. A full http(s) link
 * is accepted too, for a file that lives somewhere else. Never another scheme —
 * this lands in an `src`.
 */
export const MediaRefSchema = z.union([z.url({ protocol: /^https?$/ }), z.string().regex(/^\/api\/v1\/content\/media\/[\w.-]+$/)]);

/**
 * A shelf the effects wall and the prompt bank file their items under.
 *
 * These were zod enums with their Persian words compiled into the client,
 * which made adding a sixth shelf a deploy. They are rows now (`kind =
 * 'category'`, migration 0034), and an item points at one by `slug` — never by
 * this row's id — so renaming the label leaves every item where it was.
 *
 * `slug` is what the item stores and the server owns; `blurb` is the line
 * under the prompt bank's tabs and is absent on an effects shelf.
 */
export const ContentCategorySchema = ItemSchema.extend({
  scope: z.enum(["preset", "prompt_fragment"]),
  slug: z.string().min(1),
  label: z.string().min(1),
  blurb: z.string().min(1).optional(),
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
  /** A `ContentCategory.slug` in the `preset` scope. A string, because an admin adds shelves. */
  category: z.string().min(1),
  badge: z.string().min(1).optional(),
  /** The picture an admin uploaded. Absent on the seeded rows, which still draw placeholder art from `seed`. */
  coverUrl: MediaRefSchema.optional(),
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
  /** A `ContentCategory.slug` in the `prompt_fragment` scope. */
  category: z.string().min(1),
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
  videoUrl: MediaRefSchema.optional(),
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
  /** A picture or a short muted loop on the card. Absent means placeholder art from `seed`. */
  cover: z.object({ url: MediaRefSchema, kind: z.enum(["image", "video"]) }).optional(),
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
    /**
     * Whether signup still needs an invite code. While it does, a visitor who
     * is not signed in gets the invite page instead of the product. Absent
     * reads as on, the same way the signup gate reads it.
     */
    earlyAccess: z.boolean(),
  }),
  /** The shelves, in the admin's order. A screen reads its labels from here rather than from a compiled map. */
  categories: z.array(ContentCategorySchema),
  presets: z.array(PresetSchema),
  fragments: z.array(PromptFragmentSchema),
  skills: z.array(SkillSchema),
  featured: z.array(FeaturedItemSchema),
  courses: z.array(CourseSchema),
  examples: z.array(ExampleSchema),
  voices: z.array(VoiceSchema),
});

export type ContentStatus = z.infer<typeof ContentStatusSchema>;
export type ContentCategory = z.infer<typeof ContentCategorySchema>;
export type Preset = z.infer<typeof PresetSchema>;
export type PromptFragment = z.infer<typeof PromptFragmentSchema>;
export type ContentSkill = z.infer<typeof SkillSchema>;
export type FeaturedItem = z.infer<typeof FeaturedItemSchema>;
export type Lesson = z.infer<typeof LessonSchema>;
export type Course = z.infer<typeof CourseSchema>;
export type Example = z.infer<typeof ExampleSchema>;
export type Voice = z.infer<typeof VoiceSchema>;
export type ContentSnapshot = z.infer<typeof ContentSnapshotSchema>;

/* ---------------------------------------------------------------------------
   The admin panel's side of three of these collections.

   Effects (presets), courses and the prompt bank are edited in the panel; the
   other four still come from the seed file. The panel sees every row that is
   not archived, with its status, and writes whole items — the server gives a
   new row its code and placeholder seed, so neither is in the write.
   --------------------------------------------------------------------------- */

export const EditableContentKindSchema = z.enum(["preset", "course", "prompt_fragment", "category"]);

/** Draft or published. Deleting archives a row, and an archived row is not listed. */
export const EditableContentStatusSchema = z.enum(["draft", "published"]);

const Entry = { id: z.uuid(), status: EditableContentStatusSchema };

export const ContentEntrySchema = z.discriminatedUnion("kind", [
  z.object({ ...Entry, kind: z.literal("preset"), item: PresetSchema }),
  z.object({ ...Entry, kind: z.literal("course"), item: CourseSchema }),
  z.object({ ...Entry, kind: z.literal("prompt_fragment"), item: PromptFragmentSchema }),
  z.object({ ...Entry, kind: z.literal("category"), item: ContentCategorySchema }),
]);

export const ContentEntriesSchema = z.object({ entries: z.array(ContentEntrySchema) });

/** Caps on the free text, which the item schemas leave open because the seed file never needed them. */
const text = (max: number) => z.string().trim().min(1).max(max);

export const ContentWriteSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("preset"),
      status: EditableContentStatusSchema,
      item: PresetSchema.omit({ id: true, seed: true }).extend({ title: text(120), prompt: text(4000), badge: text(24).optional() }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("course"),
      status: EditableContentStatusSchema,
      item: CourseSchema.omit({ id: true, seed: true }).extend({
        title: text(120),
        blurb: text(600),
        lessons: z
          .array(
            LessonSchema.extend({
              id: text(64),
              title: text(160),
              seconds: z
                .number()
                .int()
                .positive()
                .max(24 * 3600),
            }),
          )
          .min(1)
          .max(100),
      }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("prompt_fragment"),
      status: EditableContentStatusSchema,
      item: PromptFragmentSchema.omit({ id: true }).extend({ label: text(80), fragment: text(400), note: text(300) }),
    })
    .strict(),
  z
    .object({
      kind: z.literal("category"),
      status: EditableContentStatusSchema,
      // No `slug`: the server mints one for a new shelf and keeps it forever
      // after, because it is what every item under the shelf points at.
      item: ContentCategorySchema.omit({ id: true, slug: true }).extend({ label: text(60), blurb: text(200).optional() }),
    })
    .strict(),
]);

/**
 * How big an upload may be, by what it is for.
 *
 * Covers are small because every visitor downloads them: a course's cover video
 * autoplays on the Academy grid, so it is a short loop, not a lesson. A lesson
 * is only fetched by someone who pressed play, and 150MB holds about ten
 * minutes of 720p. The API holds one upload in memory while it stores it, which
 * is the other reason there is a ceiling at all.
 */
export const CONTENT_MEDIA_LIMITS = {
  image: 5 * 1024 * 1024,
  coverVideo: 20 * 1024 * 1024,
  lessonVideo: 150 * 1024 * 1024,
} as const;

export const ContentMediaPurposeSchema = z.enum(["cover", "lesson"]);

export const ContentMediaSchema = z.object({
  url: MediaRefSchema,
  kind: z.enum(["image", "video"]),
  byteSize: z.number().int().positive(),
});

export type MediaRef = z.infer<typeof MediaRefSchema>;
export type EditableContentKind = z.infer<typeof EditableContentKindSchema>;
export type EditableContentStatus = z.infer<typeof EditableContentStatusSchema>;
export type ContentEntry = z.infer<typeof ContentEntrySchema>;
export type ContentWrite = z.infer<typeof ContentWriteSchema>;
export type ContentMediaPurpose = z.infer<typeof ContentMediaPurposeSchema>;
export type ContentMedia = z.infer<typeof ContentMediaSchema>;
