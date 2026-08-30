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
 *
 * **One field is deliberately outside that chain: `unlimited`.**
 *
 * It is not authored in `models.ts` and cannot be. It is derived by
 * `PostgresCatalogRepository` from `unlimited_entitlements` — the same row the
 * quote path reads before granting a free generation — so that the shop and the
 * price can never disagree about which models have the free pipe. `models.ts`
 * has no way to know what is in that table, and giving it a copy is exactly the
 * duplication the derivation exists to prevent.
 *
 * So the equality here is over the *authored* catalogue, and the marker is
 * stripped from both sides before comparing. Everything `models.ts` actually
 * writes still has to round-trip untouched, which is what this test was for.
 *
 * What that leaves uncovered offline is whether the marker matches the grants.
 * That is checked where the grants exist:
 * `packages/db/src/catalogRepository.integration.test.ts` has five tests on it,
 * including one that a marker hand-written into `capabilities` is ignored, and
 * one that a retired grant leaves the document.
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
        .filter(([key, item]) => item !== undefined && key !== "unlimited")
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

  /**
   * The derived field is stripped for the comparison above, so this is what
   * stops the strip from hiding it entirely.
   *
   * Demo mode reads this file, so if the export ever quietly stopped carrying
   * the marker the switch would vanish from demo while working in production —
   * the two disagreeing in exactly the direction this file exists to prevent,
   * and invisible because the equality test would be happier without it.
   *
   * Written as "some variant has one" rather than naming the variants: which
   * models hold a grant is a database fact and belongs in the seeder, not
   * pinned here where moving a grant would fail a test in `src/data/`.
   */
  it("still carries the derived unlimited marker for the variants that have a grant", () => {
    // The JSON import types each variant by what that particular entry holds,
    // so `unlimited` is not on the union — read it through one loose shape.
    type MaybeMarked = { unlimited?: { dailyCap: number; minTier: number } };
    const marked = snapshot.families
      .flatMap((family) => family.variants as unknown as MaybeMarked[])
      .filter((variant) => variant.unlimited !== undefined);

    expect(marked.length).toBeGreaterThan(0);
    for (const variant of marked) {
      expect(variant.unlimited).toMatchObject({
        dailyCap: expect.any(Number) as number,
        minTier: expect.any(Number) as number,
      });
    }
  });
});
