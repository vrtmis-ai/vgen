import { describe, expect, it } from "vitest";
import { unlimitedFit } from "./unlimited";
import type { Variant } from "../data/models";

const metered: Variant = { id: "flux-2-flex", featureCode: "image_generate", label: "Flex" };
const capped: Variant = {
  id: "nano-banana-pro",
  featureCode: "image_generate",
  label: "Pro",
  unlimited: { dailyCap: 50, minTier: 3, limits: { resolution: ["1K", "2K"] } },
};
const unlimitedEverySetting: Variant = {
  id: "seedream-4-5",
  featureCode: "image_generate",
  label: "۴٫۵",
  unlimited: { dailyCap: 50, minTier: 3 },
};

describe("whether the flat-fee pipe is reachable right now", () => {
  it("says nothing at all for a variant that has no pipe", () => {
    expect(unlimitedFit(metered, { resolution: "1K" }, 3)).toBeNull();
  });

  it("is reachable inside the settings the pipe covers", () => {
    expect(unlimitedFit(capped, { resolution: "2K" }, 3)).toEqual({ available: true, dailyCap: 50 });
  });

  /**
   * The case the `limits` field exists for. Without it the switch would sit
   * there looking available, and the coins would come off at 4K with no
   * explanation — the failure is silent and it costs money.
   */
  it("names the control that put it out of reach", () => {
    expect(unlimitedFit(capped, { resolution: "4K" }, 3)).toEqual({
      available: false,
      reason: "setting",
      blockedBy: "resolution",
      dailyCap: 50,
    });
  });

  /**
   * The grant's tier is not the family's. Nano Banana opens at tier 2 and its
   * grant at tier 3, so this is a plan that can reach the model and not the free
   * pipe — the case where an enabled switch would label a metered generation
   * free and the customer would find out from the receipt.
   */
  it("refuses a plan below the grant's tier, and says what it would take", () => {
    expect(unlimitedFit(capped, { resolution: "2K" }, 2)).toEqual({
      available: false,
      reason: "tier",
      needsTier: 3,
      dailyCap: 50,
    });
  });

  it("reports the tier before the setting, so a plan that cannot have it is not told which resolution would have worked", () => {
    expect(unlimitedFit(capped, { resolution: "4K" }, 1)).toMatchObject({ reason: "tier" });
  });

  it("covers every setting when the pipe names no limits", () => {
    expect(unlimitedFit(unlimitedEverySetting, { quality: "high" }, 3)).toEqual({ available: true, dailyCap: 50 });
  });

  it("carries a null cap through as the uncapped grant it is", () => {
    const uncapped: Variant = { ...capped, unlimited: { dailyCap: null, minTier: 3 } };
    expect(unlimitedFit(uncapped, {}, 3)).toEqual({ available: true, dailyCap: null });
  });

  it("treats an unset control as the variant's own default, not a violation", () => {
    // The dock has not touched resolution yet; the server prices what it is
    // sent, and refusing here would hide the switch before anyone chose.
    expect(unlimitedFit(capped, {}, 3)).toEqual({ available: true, dailyCap: 50 });
  });

  it("compares by value, whatever the control stores", () => {
    const byCount: Variant = { ...capped, unlimited: { dailyCap: 50, minTier: 3, limits: { count: ["1", "2"] } } };
    expect(unlimitedFit(byCount, { count: 2 }, 3)).toEqual({ available: true, dailyCap: 50 });
  });
});
