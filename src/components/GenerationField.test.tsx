import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerationField } from "./GenerationField";

/* ---------------------------------------------------------------------------
   The surface a generation is drawn on while it is being made.

   The particle cloud is the part you look at, and it is the part that cannot
   be relied on: it needs a WebGL context, and there are only so many of those
   per page, and somebody may have asked the system for less motion. So the
   claim worth holding is the other one — that the tile is never blank and
   never depends on the scene having loaded. jsdom has no WebGL, which makes
   this the no-context case by default.
   --------------------------------------------------------------------------- */

describe("the field under a running generation", () => {
  it("draws the css field with no context to be had", () => {
    const { container } = render(<GenerationField />);

    const field = container.querySelector(".vg-gen-field");
    expect(field).not.toBeNull();
    // Nothing claimed a slot, so the drifting light keeps its full strength.
    expect(field?.classList.contains("vg-gen-field--nebula")).toBe(false);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("stands down when the reader has asked for less motion", () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true, media: "", addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("matchMedia", matchMedia);

    const { container } = render(<GenerationField />);

    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(container.querySelector(".vg-gen-field")).not.toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps its caller's classes", () => {
    const { container } = render(<GenerationField className="rounded-xl" />);

    expect(container.querySelector(".vg-gen-field")?.classList.contains("rounded-xl")).toBe(true);
  });
});
