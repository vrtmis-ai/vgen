import type { RefSlot, SlotMedia } from "../data/models";
import { groupOf } from "./refSlots";

/* ---------------------------------------------------------------------------
   Naming the references so the prompt can point at one.

   A prompt that says "the attached image" leaves the model to decide which
   input a sentence is about, and on a multi-reference job it picks wrong — it
   will regenerate a reference video's landscape instead of animating the still
   you gave it. Naming each input and using the name at every mention pins each
   constraint to a specific file.

   The names are positional and per kind: the first reference image is
   `@Image1`, the third reference video `@Video3`. Positional is what the digit
   means, so reordering the row renames the files — which is why every tile
   wears its own current name rather than leaving you to count.

   Capitalised, because that is how Seedance 2 names its references — `@Image1`,
   `@Video1`, `@Audio1`, numbered per kind exactly like this — and it is the
   multi-reference model people use most. KIE's own schema for it documents no
   syntax at all, so this follows the model's published prompting convention,
   not a field. Other models read references their own way (Kling 3 by named
   element, `@element_dog`); that belongs in the catalogue, per model, and until
   it is there this is the one form the UI writes.

   Frame slots get no name. A start or end frame is a position in the clip, not
   material to draw from; there is nothing in a prompt to point at it with, and
   the tile says "شروع" or "پایان" instead.
   --------------------------------------------------------------------------- */

const KIND_WORD: Record<SlotMedia, string> = { image: "Image", video: "Video", audio: "Audio" };

/** Per-slot lists of names, aligned to each slot's file order. */
export function refTags(slots: RefSlot[], filled: Record<string, number>): Record<string, string[]> {
  const used: Partial<Record<SlotMedia, number>> = {};
  const tags: Record<string, string[]> = {};
  for (const slot of slots) {
    const held = filled[slot.key] ?? 0;
    if (!held || groupOf(slot) === "frame") continue;
    const kind = slot.media ?? "image";
    const word = KIND_WORD[kind];
    tags[slot.key] = Array.from({ length: held }, () => {
      const next = (used[kind] ?? 0) + 1;
      used[kind] = next;
      return `@${word}${next}`;
    });
  }
  return tags;
}

/** Every name currently in play, in row order. */
export function allTags(tags: Record<string, string[]>): string[] {
  return Object.values(tags).flat();
}

/**
 * Whether the prompt already points at this file.
 *
 * The boundary matters: without it `@Image1` reports itself present in a
 * prompt that only ever mentions `@Image10`.
 */
export function tagUsed(prompt: string, tag: string): boolean {
  return new RegExp(`${tag}(?![0-9])`).test(prompt);
}

/**
 * The prompt with a name dropped in at the caret, and where the caret lands.
 *
 * Spaces are added only where one is missing, so inserting into the middle of
 * a sentence does not double them up and inserting at the very start does not
 * open the prompt with one.
 */
export function insertTag(prompt: string, at: number, tag: string): { prompt: string; caret: number } {
  const where = Math.max(0, Math.min(at, prompt.length));
  const before = prompt.slice(0, where);
  const after = prompt.slice(where);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  const piece = lead + tag + trail;
  return { prompt: before + piece + after, caret: where + lead.length + tag.length };
}
