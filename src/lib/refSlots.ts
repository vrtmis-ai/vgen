import type { RefSlot, SlotMedia } from "../data/models";

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

/* ---------------------------------------------------------------------------
   One box instead of a stack.

   The dock used to draw a labelled upload area per slot, which on Seedance 2.5
   is three of them — image, video, audio — stacked down a 342px column and
   taller than every other control on the panel put together. Nothing about
   that asked the customer a question they could answer: a file already knows
   whether it is a picture or a clip.

   So the panel takes anything into one box and these rules decide where it
   goes. They are statements about the catalogue rather than about rendering,
   which is why they live here with the other three and are tested directly.
   --------------------------------------------------------------------------- */

/** What a picked file is, by its own MIME type. `null` is a kind no slot takes. */
export function kindOfFile(type: string): SlotMedia | null {
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  return null;
}

/** Every slot that will hold this kind of file, in catalogue order. */
export function slotsForKind(slots: RefSlot[], kind: SlotMedia): RefSlot[] {
  return slots.filter((slot) => (slot.media ?? "image") === kind);
}

/**
 * Where a freshly dropped file of this kind lands.
 *
 * A reference slot first. Dropping a picture means "here is material to draw
 * from"; it does not mean "this is the first frame of the clip", and a model
 * that offers both should not quietly pick the stronger reading. Failing that,
 * the first frame slot with room whose dependency is already satisfied — on
 * Kling and Veo there is no reference slot at all, so a frame is the only home
 * a picture has, and the order the catalogue declares them in is start, then
 * end, which is also the order somebody dropping two files means them in.
 *
 * `null` means this model does not take that kind of file, or every slot that
 * would have taken it is full.
 */
export function landingSlot(slots: RefSlot[], kind: SlotMedia, filled: Record<string, number>): RefSlot | null {
  const count = (key: string) => filled[key] ?? 0;
  const open = slotsForKind(slots, kind).filter((slot) => count(slot.key) < slot.max);
  const reference = open.find((slot) => groupOf(slot) === "reference");
  if (reference) return reference;
  return open.find((slot) => !slot.requires || count(slot.requires) > 0) ?? null;
}

/**
 * Whether every slot holding a file also has whatever that file depends on.
 *
 * Kling's end frame declares `requires: "image_url_start"` — there is no end
 * without a start — so an end frame alone is a request the provider will
 * refuse. The dock uses this to decide which parts a tile may be given: a move
 * is offered only if the arrangement it would produce still passes. Better to
 * leave the option out than to offer it and then explain, under the button,
 * why the thing the customer just chose is invalid.
 */
export function dependenciesMet(slots: RefSlot[], filled: Record<string, number>): boolean {
  const count = (key: string) => filled[key] ?? 0;
  return slots.every((slot) => !slot.requires || count(slot.key) === 0 || count(slot.requires) > 0);
}

/**
 * The one word a tile wears once a file has been given this frame's part:
 * "فریم شروع (اختیاری)" → "شروع".
 *
 * Derived rather than declared, because `RefSlot` has no field for it and
 * `src/data/` is shared — adding one is a conversation with the backend owner,
 * not a unilateral edit. The test asserts this against every frame slot in the
 * catalogue, so a re-labelled slot fails there rather than dropping a
 * parenthetical onto a 72px tile.
 */
export function roleWord(slot: RefSlot): string {
  const withoutAside = slot.label.replace(/\s*\([^)]*\)\s*$/, "").trim();
  return withoutAside.split(/\s+/).pop() || slot.label;
}
