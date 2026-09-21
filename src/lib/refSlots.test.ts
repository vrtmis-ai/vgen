import { describe, expect, it } from "vitest";
import { FAMILIES, variantRefs, type RefSlot } from "../data/models";
import {
  dependenciesMet,
  groupOf,
  kindOfFile,
  landingSlot,
  pairsImages,
  refGroups,
  frameWord,
  dockSlots,
  entrancesOf,
  resolveEntrance,
  toEntranceKeys,
  slotsForKind,
  slotsInGroup,
} from "./refSlots";

const slot = (over: Partial<RefSlot> & { key: string }): RefSlot => ({
  label: over.key,
  max: 1,
  role: over.group === "frame" ? "first_frame" : "reference",
  ...over,
});

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
  // The image model: the text one takes no files, since they would reach an
  // endpoint with no field for them.
  const v27 = wan.variants.find((v) => v.id === "wan-2-7-i2v")!;
  const frames = slotsInGroup(variantRefs(wan, v27), "frame");

  it("gives Wan 2.7 a frame group of two images", () => {
    expect(frames.map((s) => s.key)).toEqual(["first_frame_url", "last_frame_url"]);
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

describe("frameWord", () => {
  it("reads which end of the clip from the role, not the label", () => {
    expect(frameWord(slot({ key: "a", role: "first_frame", label: "هر چیزی" }))).toBe("شروع");
    expect(frameWord(slot({ key: "b", role: "last_frame", label: "هر چیزی" }))).toBe("پایان");
  });
});

/* The role is what the dock and the entrance resolver act on, so the catalogue
   has to agree with itself: a frame slot is an end of the clip, and an end of
   the clip is a frame slot. */
describe("every slot's role", () => {
  const slots = FAMILIES.flatMap((family) => family.variants.flatMap((variant) => variantRefs(family, variant)));

  it("marks every frame slot as one end of the clip, and only those", () => {
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const isEnd = s.role === "first_frame" || s.role === "last_frame";
      expect({ key: s.key, frame: groupOf(s) === "frame" }).toEqual({ key: s.key, frame: isEnd });
    }
  });

  it("gives a video or audio source slot a file of that kind", () => {
    for (const s of slots) {
      if (s.role === "source_video") expect(s.media).toBe("video");
      if (s.role === "source_audio") expect(s.media).toBe("audio");
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

/* #96. Wan 2.7 is the model the issue was written about: four variants, one
   model, and which runs is decided by what is attached. Tested against the real
   catalogue rows, because the resolver is only as right as the roles they carry. */
describe("one model, several entrances", () => {
  const wan = FAMILIES.find((family) => family.id === "wan")!;
  const entry = wan.variants.find((variant) => variant.id === "wan-2-7")!;
  const entrances = entrancesOf(wan, entry);
  const runs = (filled: Record<string, number>) => resolveEntrance(wan, entrances, filled).id;

  it("gathers the entry and its entrances, entry first, from any of them", () => {
    expect(entrances.map((variant) => variant.id)).toEqual(["wan-2-7", "wan-2-7-i2v", "wan-2-7-videoedit", "wan-2-7-r2v"]);
    const fromEntrance = entrancesOf(
      wan,
      wan.variants.find((variant) => variant.id === "wan-2-7-r2v")!,
    );
    expect(fromEntrance.map((variant) => variant.id)).toEqual(entrances.map((variant) => variant.id));
  });

  it.each([
    [{}, "wan-2-7"],
    [{ "source_video:video": 1 }, "wan-2-7-videoedit"],
    [{ "first_frame:image": 1 }, "wan-2-7-i2v"],
    [{ "first_frame:image": 1, "last_frame:image": 1 }, "wan-2-7-i2v"],
    [{ "reference:image": 2 }, "wan-2-7-r2v"],
    [{ "reference:image": 1, "first_frame:image": 1 }, "wan-2-7-r2v"],
    [{ "source_video:video": 1, "reference:image": 1 }, "wan-2-7-videoedit"],
    [{ "source_audio:audio": 1 }, "wan-2-7"],
    [{ "source_audio:audio": 1, "first_frame:image": 1 }, "wan-2-7-i2v"],
  ])("runs %o as %s", (filled, expected) => {
    expect(runs(filled)).toBe(expected);
  });

  it("offers the union by role, none of it required, the end frame still after the start", () => {
    const slots = dockSlots(wan, entrances);
    expect(slots.map((slot) => slot.key).sort()).toEqual(
      ["first_frame:image", "last_frame:image", "reference:image", "source_audio:audio", "source_video:video"].sort(),
    );
    expect(slots.some((slot) => slot.required)).toBe(false);
    expect(slots.find((slot) => slot.key === "last_frame:image")?.requires).toBe("first_frame:image");
    // Five references on r2v, one on videoedit: the box takes the larger.
    expect(slots.find((slot) => slot.key === "reference:image")?.max).toBe(5);
  });

  it("sends the opening frame under whatever the running entrance calls it", () => {
    const i2v = wan.variants.find((variant) => variant.id === "wan-2-7-i2v")!;
    const r2v = wan.variants.find((variant) => variant.id === "wan-2-7-r2v")!;
    expect(toEntranceKeys(wan, i2v, { "first_frame:image": ["a"] })).toEqual({ first_frame_url: ["a"] });
    expect(toEntranceKeys(wan, r2v, { "first_frame:image": ["a"], "reference:image": ["b"] })).toEqual({
      first_frame: ["a"],
      reference_image: ["b"],
    });
  });

  it("keeps a file the entrance cannot take under its role, so validation can name it", () => {
    expect(toEntranceKeys(wan, entry, { "source_video:video": ["clip"] })).toEqual({ "source_video:video": ["clip"] });
  });

  it("leaves an ordinary model exactly as it was", () => {
    const seedance = FAMILIES.find((family) => family.variants.some((variant) => variant.id === "seedance-2"))!;
    const variant = seedance.variants.find((candidate) => candidate.id === "seedance-2")!;
    expect(entrancesOf(seedance, variant)).toEqual([variant]);
    expect(dockSlots(seedance, [variant])).toEqual(variantRefs(seedance, variant));
  });
});
