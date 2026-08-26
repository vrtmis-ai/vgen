import { describe, expect, it } from "vitest";
import { unlimitedFit } from "./unlimited";
import type { Variant } from "../data/models";

const metered: Variant = { id: "flux-2-flex", featureCode: "image_generate", label: "Flex" };
const capped: Variant = {
  id: "nano-banana-pro",
  featureCode: "image_generate",
  label: "Pro",
  unlimited: { dailyCap: 50, limits: { resolution: ["1K", "2K"] } },
};
const uncapped: Variant = {
  id: "seedream-4-5",
  featureCode: "image_generate",
  label: "۴٫۵",
  unlimited: { dailyCap: 50 },
};

describe("whether the flat-fee pipe is reachable right now", () => {
  it("says nothing at all for a variant that has no pipe", () => {
    expect(unlimitedFit(metered, { resolution: "1K" })).toBeNull();
  });

  it("is reachable inside the settings the pipe covers", () => {
    expect(unlimitedFit(capped, { resolution: "2K" })).toEqual({ available: true, dailyCap: 50 });
  });

  /**
   * The case the `limits` field exists for. Without it the switch would sit
   * there looking available, and the coins would come off at 4K with no
   * explanation — the failure is silent and it costs money.
   */
  it("names the control that put it out of reach", () => {
    expect(unlimitedFit(capped, { resolution: "4K" })).toEqual({ available: false, dailyCap: 50, blockedBy: "resolution" });
  });

  it("covers every setting when the pipe names no limits", () => {
    expect(unlimitedFit(uncapped, { quality: "high" })).toEqual({ available: true, dailyCap: 50 });
  });

  it("treats an unset control as the variant's own default, not a violation", () => {
    // The dock has not touched resolution yet; the server prices what it is
    // sent, and refusing here would hide the switch before anyone chose.
    expect(unlimitedFit(capped, {})).toEqual({ available: true, dailyCap: 50 });
  });

  it("compares by value, whatever the control stores", () => {
    expect(unlimitedFit({ ...capped, unlimited: { dailyCap: 50, limits: { count: ["1", "2"] } } }, { count: 2 })).toEqual({
      available: true,
      dailyCap: 50,
    });
  });
});
