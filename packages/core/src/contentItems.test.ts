import { describe, expect, it } from "vitest";
import { UnknownContentKindError, toContentItem, type ContentSeedRow } from "./contentItems";

/**
 * The mapping the seeder and the API both go through.
 *
 * These are not shape tests for their own sake. Every case below is a way a
 * content row can be wrong that nothing else would catch until a customer
 * opened the screen — a preset whose category never reached the schema, a
 * course with no lessons, a voice with no name. The seeder runs this function
 * over every row before it writes one, so a failure here is a failure to seed
 * rather than a broken card.
 */

const row = (overrides: Partial<ContentSeedRow> & Pick<ContentSeedRow, "kind" | "code">): ContentSeedRow => ({
  title: null,
  subtitle: null,
  body: null,
  category: null,
  familyCode: null,
  seed: null,
  payload: {},
  ...overrides,
});

const preset = (overrides: Partial<ContentSeedRow> = {}) =>
  row({
    kind: "preset",
    code: "p1",
    title: "زوم زمین",
    body: "extreme continuous zoom out, of ",
    category: "camera",
    familyCode: "seedance",
    seed: "vgen-earthzoom",
    payload: { kind: "video", openEnded: true },
    ...overrides,
  });

describe("toContentItem", () => {
  it("keeps a preset's category, which the column carries and the payload does not", () => {
    const parsed = toContentItem(preset());
    expect(parsed.kind).toBe("preset");
    if (parsed.kind !== "preset") throw new Error("narrowing");
    expect(parsed.item).toEqual({
      id: "p1",
      title: "زوم زمین",
      familyId: "seedance",
      seed: "vgen-earthzoom",
      prompt: "extreme continuous zoom out, of ",
      category: "camera",
      openEnded: true,
      kind: "video",
    });
  });

  it("omits badge rather than setting it undefined", () => {
    const parsed = toContentItem(preset());
    // `exactOptionalPropertyTypes` is on: an explicit undefined is a different
    // thing from an absent key, and only the absent one round-trips through JSON.
    expect("badge" in (parsed.item as object)).toBe(false);
    const badged = toContentItem(preset({ payload: { kind: "video", openEnded: true, badge: "پرطرفدار" } }));
    expect((badged.item as { badge?: string }).badge).toBe("پرطرفدار");
  });

  it("treats a missing openEnded as false rather than refusing the row", () => {
    // A preset that fails to parse is a card that vanishes. Defaulting is right
    // here because false is also the safe reading: the surface replaces the
    // prompt instead of appending, which shows the user something is wrong
    // rather than silently keeping text they did not want.
    const parsed = toContentItem(preset({ payload: { kind: "image" } }));
    expect((parsed.item as { openEnded: boolean }).openEnded).toBe(false);
  });

  it("reads a course's level from the column, not a second copy in the payload", () => {
    const parsed = toContentItem(
      row({
        kind: "course",
        code: "c-start",
        title: "از صفر تا اولین ویدیو",
        subtitle: "در چهل دقیقه اولین ویدیوی خودت را می‌سازی.",
        category: "beginner",
        seed: "vgen-course-start",
        payload: { lessons: [{ id: "l1", title: "مدل، پرامپت، سکه", seconds: 420 }] },
      }),
    );
    if (parsed.kind !== "course") throw new Error("narrowing");
    expect(parsed.item.level).toBe("beginner");
    expect(parsed.item.lessons).toHaveLength(1);
  });

  it("refuses a course with no lessons", () => {
    // Which is a course page that renders a heading and nothing under it.
    expect(() =>
      toContentItem(
        row({ kind: "course", code: "c-empty", title: "t", subtitle: "b", category: "beginner", seed: "s", payload: { lessons: [] } }),
      ),
    ).toThrow();
  });

  it("refuses a preset whose category is not one the grid has a tab for", () => {
    expect(() => toContentItem(preset({ category: "cinematography" }))).toThrow();
  });

  it("refuses a fragment with no fragment", () => {
    expect(() =>
      toContentItem(row({ kind: "prompt_fragment", code: "f1", title: "دالی", subtitle: "note", category: "camera", body: null })),
    ).toThrow();
  });

  it("carries a skill's optional coins only when priced", () => {
    const base = { kind: "skill", code: "s-ugc", title: "t", subtitle: "b", seed: "s" } as const;
    const unpriced = toContentItem(row({ ...base, payload: { steps: [{ label: "step" }] } }));
    expect("coins" in (unpriced.item as object)).toBe(false);
    const priced = toContentItem(row({ ...base, payload: { steps: [{ label: "step" }], coins: 210 } }));
    expect((priced.item as { coins?: number }).coins).toBe(210);
  });

  it("maps a voice out of the same columns every other kind uses", () => {
    const parsed = toContentItem(row({ kind: "voice", code: "EkK5I93UQWFDigLMpZcX", title: "James", subtitle: "خش‌دار، گیرا و جسور" }));
    if (parsed.kind !== "voice") throw new Error("narrowing");
    expect(parsed.item).toEqual({ id: "EkK5I93UQWFDigLMpZcX", name: "James", note: "خش‌دار، گیرا و جسور" });
  });

  it("names an unmapped kind instead of dropping it", () => {
    // The failure mode this replaces is silent: a kind added to the CHECK
    // constraint and to the seed file but not here would seed cleanly and then
    // simply not appear in the payload, with nothing anywhere saying why.
    expect(() => toContentItem(row({ kind: "tutorial", code: "x" }))).toThrow(UnknownContentKindError);
  });
});
