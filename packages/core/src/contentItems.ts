import {
  CourseSchema,
  ExampleSchema,
  FeaturedItemSchema,
  PresetSchema,
  PromptFragmentSchema,
  SkillSchema,
  VoiceSchema,
  type ContentSnapshot,
} from "@vgen/contracts";

/**
 * One stored content row to one thing a screen can render.
 *
 * It lives in core rather than in the repository because **two callers need the
 * identical mapping and they cannot see each other**: the repository reads rows
 * out of Postgres, and `scripts/publish-content.ts` parses every seed row
 * through this same function before it writes one. That is what makes "it
 * seeded" and "a screen can render it" the same statement instead of two hopes
 * — a course with no lessons is refused at seed time rather than discovered by
 * a customer opening Academy.
 *
 * Two copies of this mapping would drift the way modelRoutesRepository and
 * claim() are only kept honest by an integration test. One copy cannot.
 */

/** The shape the seed file holds and the repository reconstructs from columns. */
export interface ContentSeedRow {
  kind: string;
  code: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  category: string | null;
  familyCode: string | null;
  seed: string | null;
  payload: Record<string, unknown>;
}

export type ParsedContentItem =
  | { kind: "preset"; item: ContentSnapshot["presets"][number] }
  | { kind: "prompt_fragment"; item: ContentSnapshot["fragments"][number] }
  | { kind: "skill"; item: ContentSnapshot["skills"][number] }
  | { kind: "featured"; item: ContentSnapshot["featured"][number] }
  | { kind: "course"; item: ContentSnapshot["courses"][number] }
  | { kind: "example"; item: ContentSnapshot["examples"][number] }
  | { kind: "voice"; item: ContentSnapshot["voices"][number] };

export class UnknownContentKindError extends Error {
  constructor(kind: string) {
    super(`content_items.kind "${kind}" has no mapping - add one to toContentItem`);
    this.name = "UnknownContentKindError";
  }
}

/** Present only when set. `exactOptionalPropertyTypes` refuses an explicit undefined. */
const maybe = <T>(key: string, value: T | null | undefined): Record<string, T> =>
  value === null || value === undefined ? {} : { [key]: value };

/**
 * One stored row to one renderable item, parsed by its kind's schema.
 *
 * Throws on anything that does not parse. That is the intended behaviour on
 * both sides: the seeder refuses to write it, and the API fails loudly rather
 * than serving a half-built card that a screen will crash on.
 */
export function toContentItem(row: ContentSeedRow): ParsedContentItem {
  const payload = row.payload ?? {};

  switch (row.kind) {
    case "preset":
      return {
        kind: "preset",
        item: PresetSchema.parse({
          id: row.code,
          title: row.title,
          familyId: row.familyCode,
          seed: row.seed,
          prompt: row.body,
          category: row.category,
          openEnded: payload["openEnded"] === true,
          kind: payload["kind"],
          ...maybe("badge", payload["badge"]),
        }),
      };

    case "prompt_fragment":
      return {
        kind: "prompt_fragment",
        item: PromptFragmentSchema.parse({
          id: row.code,
          label: row.title,
          fragment: row.body,
          category: row.category,
          note: row.subtitle,
        }),
      };

    case "skill":
      return {
        kind: "skill",
        item: SkillSchema.parse({
          id: row.code,
          title: row.title,
          blurb: row.subtitle,
          seed: row.seed,
          steps: payload["steps"],
          ...maybe("coins", payload["coins"]),
        }),
      };

    case "featured":
      return {
        kind: "featured",
        item: FeaturedItemSchema.parse({
          id: row.code,
          kind: payload["kind"],
          title: row.title,
          subtitle: row.subtitle,
          seed: row.seed,
          ...maybe("familyId", row.familyCode),
          ...maybe("prompt", row.body),
        }),
      };

    case "course":
      return {
        kind: "course",
        item: CourseSchema.parse({
          id: row.code,
          title: row.title,
          blurb: row.subtitle,
          seed: row.seed,
          // From the column, not the payload. `category` is what an admin
          // groups by and what the index covers; a second copy in jsonb is a
          // second thing to keep true.
          level: row.category,
          lessons: payload["lessons"],
          ...maybe("familyId", row.familyCode),
        }),
      };

    case "example":
      return {
        kind: "example",
        item: ExampleSchema.parse({
          id: row.code,
          familyId: row.familyCode,
          prompt: row.body,
          seed: row.seed,
          w: payload["w"],
          h: payload["h"],
        }),
      };

    case "voice":
      return { kind: "voice", item: VoiceSchema.parse({ id: row.code, name: row.title, note: row.subtitle }) };

    default:
      throw new UnknownContentKindError(row.kind);
  }
}
