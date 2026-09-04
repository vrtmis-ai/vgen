import { describe, expect, it } from "vitest";
import { FAMILIES, variantRefs, type RefSlot } from "../data/models";
import { pairsImages, refGroups, slotsInGroup } from "./refSlots";

const slot = (over: Partial<RefSlot> & { key: string }): RefSlot => ({ label: over.key, max: 1, ...over });

describe("refGroups", () => {
  it("treats a slot with no group as a reference", () => {
    expect(refGroups([slot({ key: "a" })])).toEqual(["reference"]);
  });

  it("lists each group once, in catalogue order", () => {
    const slots = [slot({ key: "a", group: "frame" }), slot({ key: "b", group: "frame" }), slot({ key: "c" })];
    expect(refGroups(slots)).toEqual(["frame", "reference"]);
  });
});

describe("slotsInGroup", () => {
  const mixed = [slot({ key: "start", group: "frame" }), slot({ key: "ref" })];

  it("filters to the active group when there is more than one", () => {
    expect(slotsInGroup(mixed, "frame").map((s) => s.key)).toEqual(["start"]);
    expect(slotsInGroup(mixed, "reference").map((s) => s.key)).toEqual(["ref"]);
  });

  it("shows every slot when there is only one group, whatever is asked for", () => {
    const single = [slot({ key: "a" }), slot({ key: "b" })];
    expect(slotsInGroup(single, "frame").map((s) => s.key)).toEqual(["a", "b"]);
  });
});

describe("pairsImages", () => {
  it("pairs two image frames", () => {
    expect(pairsImages([slot({ key: "first" }), slot({ key: "last" })])).toBe(true);
  });

  it("leaves a lone image full width", () => {
    expect(pairsImages([slot({ key: "only" })])).toBe(false);
  });

  it("ignores non-image slots when deciding, and still pairs the images beside them", () => {
    // Wan 2.7's frame group, which the old "exactly two slots" rule stacked.
    const wan = [slot({ key: "first" }), slot({ key: "last" }), slot({ key: "clip", media: "video" })];
    expect(pairsImages(wan)).toBe(true);
  });

  it("does not pair when only one of the slots is an image", () => {
    expect(pairsImages([slot({ key: "img" }), slot({ key: "aud", media: "audio" })])).toBe(false);
  });
});

describe("against the real catalogue", () => {
  const wan = FAMILIES.find((f) => f.id === "wan")!;
  const v27 = wan.variants.find((v) => v.label === "۲٫۷")!;
  const frames = slotsInGroup(variantRefs(wan, v27), "frame");

  it("gives Wan 2.7 a frame group of two images and a clip", () => {
    expect(frames.map((s) => s.key)).toEqual(["first_frame_url", "last_frame_url", "first_clip_url"]);
  });

  it("pairs that group's two frames", () => {
    expect(pairsImages(frames)).toBe(true);
  });

  it("keeps its driving audio out of the frame group", () => {
    const refs = slotsInGroup(variantRefs(wan, v27), "reference");
    expect(refs.map((s) => s.key)).toEqual(["driving_audio_url"]);
  });
});
