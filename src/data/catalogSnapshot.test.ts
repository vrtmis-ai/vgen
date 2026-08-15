import { describe, expect, it } from "vitest";
import { FAMILIES } from "./models";
import snapshot from "./catalog.snapshot.json";

/**
 * The committed snapshot has to equal the catalog it was generated from.
 *
 * Together with the CI step that reseeds Postgres, re-exports, and diffs this
 * file, it pins the whole chain:
 *
 *   this test           committed snapshot == FAMILIES      (offline)
 *   the CI diff         what the database serves == committed snapshot
 *   therefore           what the database serves == FAMILIES
 *
 * Which is the property that actually matters, and the one neither check
 * establishes alone. Without this half, a seeder that quietly dropped a field
 * would produce a smaller snapshot, the diff would be satisfied by committing
 * it, and demo mode and production would agree — on the wrong catalog.
 *
 * Regenerate with `pnpm catalog:publish && pnpm catalog:snapshot`.
 */

/**
 * Key order and absent optionals, normalised away.
 *
 * Zod rebuilds objects in schema order rather than input order, so the snapshot
 * spells the same control with its keys in a different sequence. That is not a
 * difference in the catalog, and comparing raw JSON text would report all
 * nineteen families as broken every run.
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

describe("committed catalog snapshot", () => {
  it("is exactly the catalog in models.ts, round-tripped through Postgres", () => {
    expect(canonical(snapshot.families)).toEqual(canonical(FAMILIES));
  });

  it("carries every variant, so demo mode offers what the API sells", () => {
    const variants = (families: { variants: unknown[] }[]) => families.reduce((count, family) => count + family.variants.length, 0);
    expect(variants(snapshot.families)).toBe(variants(FAMILIES));
  });
});
