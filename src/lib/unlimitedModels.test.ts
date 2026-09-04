import { describe, expect, it } from "vitest";
import { unlimitedModelNames } from "./unlimitedModels";
import { FAMILIES } from "../data/models";

describe("naming the models the pipe covers", () => {
  /**
   * Against the real catalogue, because the point of this function is that the
   * sentence follows the catalogue rather than a string somebody has to
   * remember to edit. A fixture here would only prove the function agrees with
   * this test.
   */
  it("names exactly the variants marked in the catalogue", () => {
    // Seedream 4.5 was on this list on a guess, before the catalogue could be
    // asked. `unlimited_entitlements` grants the pipe to the two Nano Bananas
    // and to nothing else, so the shop must not go on naming a third.
    expect(unlimitedModelNames(FAMILIES)).toEqual(["Nano Banana Pro", "Nano Banana نسخه ۲"]);
  });

  it("says nothing when nothing is covered", () => {
    expect(unlimitedModelNames(FAMILIES.filter((f) => f.id === "flux"))).toEqual([]);
  });

  it("follows the catalogue rather than a remembered list", () => {
    // The failure this replaces: copy said two models while the catalogue held
    // three, on the page that sells the benefit.
    const marked = FAMILIES.flatMap((f) => f.variants.filter((v) => v.unlimited));
    expect(unlimitedModelNames(FAMILIES)).toHaveLength(marked.length);
  });
});
