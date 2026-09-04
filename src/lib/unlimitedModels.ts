import type { Family } from "../data/models";

/**
 * The models the flat-fee pipe actually covers, as the shop would name them.
 *
 * Read from the catalogue rather than written into copy. The plans screen used
 * to say "Nano Banana Pro و Nano Banana 2" as a literal string, and by the time
 * a third variant gained the pipe that sentence was quietly wrong — on the page
 * whose whole job is telling somebody what they are buying.
 *
 * "Family · variant" only where a family has more than one covered variant, so
 * the common case reads as a product name rather than as a path.
 */
export function unlimitedModelNames(families: readonly Family[]): string[] {
  const names: string[] = [];
  for (const family of families) {
    const covered = family.variants.filter((variant) => variant.unlimited);
    if (covered.length === 0) continue;
    // One covered variant out of one: the family name is the whole answer.
    if (covered.length === 1 && family.variants.length === 1) names.push(family.name);
    else for (const variant of covered) names.push(`${family.name} ${variant.label}`);
  }
  return names;
}
