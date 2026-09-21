import { describe, expect, it } from "vitest";
import type { RefSlot } from "../data/models";
import { allTags, insertTag, refTags, tagUsed } from "./refTags";

const slot = (over: Partial<RefSlot> & { key: string }): RefSlot => ({ label: over.key, max: 9, ...over });

const seedance = [
  slot({ key: "reference_image_urls" }),
  slot({ key: "reference_video_urls", media: "video" }),
  slot({ key: "reference_audio_urls", media: "audio" }),
];

describe("refTags", () => {
  it("numbers per kind, in row order, in Seedance's own form", () => {
    const tags = refTags(seedance, { reference_image_urls: 2, reference_video_urls: 3 });
    expect(tags.reference_image_urls).toEqual(["@Image1", "@Image2"]);
    expect(tags.reference_video_urls).toEqual(["@Video1", "@Video2", "@Video3"]);
  });

  it("names nothing for an empty slot", () => {
    expect(refTags(seedance, {})).toEqual({});
  });

  it("leaves frames unnamed — a frame is a position, not material", () => {
    const kling = [slot({ key: "image_url_start", group: "frame", max: 1 }), slot({ key: "image_url_end", group: "frame", max: 1 })];
    expect(refTags(kling, { image_url_start: 1, image_url_end: 1 })).toEqual({});
  });

  it("keeps one run of numbers across two reference slots of a kind", () => {
    const two = [slot({ key: "a" }), slot({ key: "b" })];
    expect(allTags(refTags(two, { a: 1, b: 2 }))).toEqual(["@Image1", "@Image2", "@Image3"]);
  });
});

describe("tagUsed", () => {
  it("finds the name in the prompt", () => {
    expect(tagUsed("نور روی @Image1 بیفتد", "@Image1")).toBe(true);
  });

  it("does not mistake @Image10 for @Image1", () => {
    expect(tagUsed("@Image10 را روشن کن", "@Image1")).toBe(false);
    expect(tagUsed("@Image10 را روشن کن", "@Image10")).toBe(true);
  });
});

describe("insertTag", () => {
  it("drops the name in at the caret and reports where the caret lands", () => {
    const out = insertTag("نور روی بیفتد", 8, "@Image1");
    expect(out.prompt).toBe("نور روی @Image1 بیفتد");
    expect(out.prompt.slice(0, out.caret)).toBe("نور روی @Image1");
  });

  it("adds no space it does not need", () => {
    expect(insertTag("", 0, "@Image1").prompt).toBe("@Image1");
    expect(insertTag("نور روی ", 8, "@Image1").prompt).toBe("نور روی @Image1");
  });

  it("clamps a caret outside the text", () => {
    expect(insertTag("سلام", 99, "@Image1").prompt).toBe("سلام @Image1");
    expect(insertTag("سلام", -3, "@Image1").prompt).toBe("@Image1 سلام");
  });
});
