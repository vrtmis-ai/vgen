import type { RefSlot } from "../data/models";

/* ---------------------------------------------------------------------------
   How a model's upload slots are grouped and laid out.

   Rules about the catalogue, not about rendering, which is why they live here
   and are tested directly: the panel that draws them has to be stood up with
   a session, a catalogue and a router before it will render at all, and a bug
   in these three lines is not worth that much scaffolding to catch.
   --------------------------------------------------------------------------- */

/** Absent means reference — see `RefSlot.group`. */
export function groupOf(slot: RefSlot): "reference" | "frame" {
  return slot.group ?? "reference";
}

/** The distinct groups present, in the order the catalogue lists them. */
export function refGroups(slots: RefSlot[]): ("reference" | "frame")[] {
  return [...new Set(slots.map(groupOf))];
}

/**
 * The slots on screen for the selected group.
 *
 * One group means no segmented control and no filtering — a control with a
 * single option is a label pretending to be a choice.
 */
export function slotsInGroup(slots: RefSlot[], active: "reference" | "frame"): RefSlot[] {
  return refGroups(slots).length > 1 ? slots.filter((slot) => groupOf(slot) === active) : slots;
}

/** Absent means image — see `RefSlot.media`. */
export function isImageSlot(slot: RefSlot): boolean {
  return (slot.media ?? "image") === "image";
}

/**
 * Whether the image slots on screen should sit two-up.
 *
 * A start frame and an end frame are a matched pair: the eye compares them
 * across, and stacking them loses that they are two ends of one thing. A clip
 * or an audio track is its own question and takes the full row.
 *
 * The rule counts *images*, not slots. Counting slots — "exactly two means
 * side by side" — stacked all of Wan 2.7's frames, because its frame group is
 * a start image, an end image and a start clip.
 */
export function pairsImages(shown: RefSlot[]): boolean {
  return shown.filter(isImageSlot).length > 1;
}
