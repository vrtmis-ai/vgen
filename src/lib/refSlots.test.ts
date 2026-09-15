import { describe, expect, it } from "vitest";
import { FAMILIES, variantRefs, type RefSlot } from "../data/models";
import {
  dependenciesMet,
  groupOf,
  kindOfFile,
  landingSlot,
  pairsImages,
  refGroups,
  roleWord,
  slotsForKind,
  slotsInGroup,
} from "./refSlots";

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

describe("kindOfFile", () => {
  it("reads the kind off the MIME type", () => {
    expect(kindOfFile("image/png")).toBe("image");
    expect(kindOfFile("video/quicktime")).toBe("video");
    expect(kindOfFile("audio/mpeg")).toBe("audio");
  });

  it("returns null for anything no slot takes", () => {
    expect(kindOfFile("application/pdf")).toBeNull();
    expect(kindOfFile("")).toBeNull();
  });
});

describe("slotsForKind", () => {
  it("treats a slot with no media as an image slot", () => {
    expect(slotsForKind([slot({ key: "a" })], "image").map((s) => s.key)).toEqual(["a"]);
  });
});

describe("landingSlot", () => {
  const seedance = [
    slot({ key: "reference_image_urls", max: 9 }),
    slot({ key: "reference_video_urls", max: 3, media: "video" }),
    slot({ key: "reference_audio_urls", max: 3, media: "audio" }),
  ];
  const kling = [
    slot({ key: "image_url_start", group: "frame" }),
    slot({ key: "image_url_end", group: "frame", requires: "image_url_start" }),
  ];

  it("sends each kind to its own slot", () => {
    expect(landingSlot(seedance, "video", {})?.key).toBe("reference_video_urls");
    expect(landingSlot(seedance, "audio", {})?.key).toBe("reference_audio_urls");
  });

  it("prefers a reference slot over a frame", () => {
    const both = [slot({ key: "start", group: "frame" }), slot({ key: "ref" })];
    expect(landingSlot(both, "image", {})?.key).toBe("ref");
  });

  it("fills frames in catalogue order when there is no reference slot", () => {
    expect(landingSlot(kling, "image", {})?.key).toBe("image_url_start");
    expect(landingSlot(kling, "image", { image_url_start: 1 })?.key).toBe("image_url_end");
  });

  it("will not open a dependent slot before the one it depends on", () => {
    const endOnly = [slot({ key: "end", group: "frame", requires: "start" })];
    expect(landingSlot(endOnly, "image", {})).toBeNull();
  });

  it("returns null when the model takes no such kind, and when every slot is full", () => {
    expect(landingSlot(kling, "audio", {})).toBeNull();
    expect(landingSlot(kling, "image", { image_url_start: 1, image_url_end: 1 })).toBeNull();
  });
});

describe("roleWord", () => {
  it("drops the parenthetical and keeps the last word", () => {
    expect(roleWord(slot({ key: "a", label: "فریم شروع (اختیاری)" }))).toBe("شروع");
    expect(roleWord(slot({ key: "b", label: "فریم پایان" }))).toBe("پایان");
    expect(roleWord(slot({ key: "c", label: "کلیپ شروع (اختیاری)" }))).toBe("شروع");
  });

  /* The tile it goes on is 72px. If a frame slot is ever re-labelled into
     something that does not reduce to one short word, this fails here rather
     than overflowing the tile in Persian on somebody's phone. */
  it("gives every frame slot in the catalogue one short word", () => {
    const frames = FAMILIES.flatMap((family) =>
      family.variants.flatMap((variant) => variantRefs(family, variant).filter((s) => groupOf(s) === "frame")),
    );
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      const word = roleWord(frame);
      expect(word).not.toMatch(/[()\s]/);
      expect(word.length).toBeLessThanOrEqual(8);
    }
  });
});

describe("dependenciesMet", () => {
  const kling = [
    slot({ key: "image_url_start", group: "frame" }),
    slot({ key: "image_url_end", group: "frame", requires: "image_url_start" }),
  ];

  it("passes when the dependent slot is empty", () => {
    expect(dependenciesMet(kling, {})).toBe(true);
    expect(dependenciesMet(kling, { image_url_start: 1 })).toBe(true);
  });

  it("passes when both ends are filled", () => {
    expect(dependenciesMet(kling, { image_url_start: 1, image_url_end: 1 })).toBe(true);
  });

  it("fails on an end frame with no start", () => {
    expect(dependenciesMet(kling, { image_url_end: 1 })).toBe(false);
  });
});
