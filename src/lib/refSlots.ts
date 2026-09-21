import { variantRefs, type Family, type RefSlot, type SlotMedia, type Variant } from "../data/models";

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
 * The one word a frame tile wears: which end of the clip it is.
 *
 * Read from the slot's declared role. It used to be parsed out of the label —
 * the last word of "فریم شروع (اختیاری)" — which held only as long as nobody
 * re-worded one.
 */
export function frameWord(slot: RefSlot): string {
  return slot.role === "last_frame" ? "پایان" : "شروع";
}

/* ---------------------------------------------------------------------------
   One model, several entrances (#96).

   Wan 2.7 is four variants and one model: which runs is decided by what is
   attached. The dock offers the union of the entrances' slots and resolves the
   entrance from the files each time it prices or submits.

   Slots are held by what they are for — role and media — rather than by the
   provider's key, because the same opening frame is `first_frame_url` on one
   entrance and `first_frame` on another. `toEntranceKeys` renames them back
   for the entrance that actually runs. An ordinary model, with no entrances,
   goes through all of this untouched.
   --------------------------------------------------------------------------- */

/** The key a slot is held under in a grouped dock: what it is, not what one provider calls it. */
export function roleKey(slot: RefSlot): string {
  return `${slot.role}:${slot.media ?? "image"}`;
}

/** The entry and the variants that name it, entry first. Just the variant for an ordinary model. */
export function entrancesOf(family: Family, variant: Variant): Variant[] {
  const entryId = variant.entryOf ?? variant.id;
  const entry = family.variants.find((candidate) => candidate.id === entryId) ?? variant;
  return [entry, ...family.variants.filter((candidate) => candidate.entryOf === entryId)];
}

/**
 * The slots a dock offers: the model's own, or its entrances' merged by role.
 *
 * A merged slot is required only if the entry requires it — attaching nothing
 * is itself a way in — so its label says optional where an entrance's said
 * required. The resolved entrance's own limits still apply: validation runs
 * against it, not against this union.
 */
export function dockSlots(family: Family, entrances: Variant[]): RefSlot[] {
  const entry = entrances[0];
  if (!entry) return [];
  if (entrances.length === 1) return variantRefs(family, entry);
  const entryRequires = new Set(
    variantRefs(family, entry)
      .filter((slot) => slot.required)
      .map(roleKey),
  );
  const union = new Map<string, RefSlot>();
  for (const member of entrances) {
    const own = variantRefs(family, member);
    for (const slot of own) {
      const key = roleKey(slot);
      const held = union.get(key);
      if (held) {
        union.set(key, { ...held, max: Math.max(held.max, slot.max) });
        continue;
      }
      const dependency = slot.requires ? own.find((other) => other.key === slot.requires) : undefined;
      const required = entryRequires.has(key);
      union.set(key, {
        key,
        role: slot.role,
        label: required ? slot.label : slot.label.replace("(الزامی)", "(اختیاری)"),
        max: slot.max,
        ...(slot.group ? { group: slot.group } : {}),
        ...(slot.media ? { media: slot.media } : {}),
        ...(slot.maxMb ? { maxMb: slot.maxMb } : {}),
        ...(required ? { required: true } : {}),
        ...(dependency ? { requires: roleKey(dependency) } : {}),
      });
    }
  }
  return [...union.values()];
}

/**
 * Which entrance the attachments call for, counted by role key.
 *
 * The one that takes everything attached and is missing the fewest of its
 * own required inputs, entry first on a tie: nothing attached is the entry, a
 * clip is the edit, a frame is image-to-video, references are
 * reference-to-video. When no entrance takes the whole set the entry stays,
 * and validation names the file it cannot place.
 */
export function resolveEntrance(family: Family, entrances: Variant[], filled: Record<string, number>): Variant {
  const has = (key: string) => (filled[key] ?? 0) > 0;
  const attached = Object.keys(filled).filter(has);
  let best = entrances[0]!;
  let fewestMissing = Number.POSITIVE_INFINITY;
  for (const member of entrances) {
    const own = variantRefs(family, member);
    const takes = new Set(own.map(roleKey));
    if (!attached.every((key) => takes.has(key))) continue;
    const missing = own.filter((slot) => slot.required && !has(roleKey(slot))).length;
    if (missing < fewestMissing) {
      best = member;
      fewestMissing = missing;
    }
  }
  return best;
}

/**
 * What a grouped dock holds, under the keys the running entrance names.
 *
 * A role the entrance has no slot for keeps its role key, so validation reports
 * it as a file this model cannot take rather than the file silently vanishing.
 */
export function toEntranceKeys<T>(family: Family, entrance: Variant, held: Record<string, T[]>): Record<string, T[]> {
  const own = variantRefs(family, entrance);
  const out: Record<string, T[]> = {};
  for (const [key, items] of Object.entries(held)) {
    if (items.length === 0) continue;
    const target = own.find((slot) => roleKey(slot) === key)?.key ?? key;
    out[target] = [...(out[target] ?? []), ...items];
  }
  return out;
}
