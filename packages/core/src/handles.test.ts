import { describe, expect, it } from "vitest";
import { HANDLE_MAX, HANDLE_MIN, mintHandle, normalizeHandle } from "./handles";

describe("reading a handle somebody typed", () => {
  it("takes the shapes the ten seeded authors already use", () => {
    for (const handle of ["reza.vfx", "pixel_arman", "atelier.sahar", "darkroom.h", "u1x"]) {
      expect(normalizeHandle(handle)).toBe(handle);
    }
  });

  it("tidies case and surrounding space, which nobody means", () => {
    expect(normalizeHandle("  Reza.VFX  ")).toBe("reza.vfx");
  });

  it("accepts Persian digits, because a Persian keyboard produces them", () => {
    expect(normalizeHandle("reza۱۲۳")).toBe("reza123");
  });

  it("refuses anything that is not a username rather than rewriting it", () => {
    // Silently handing somebody a different name than the one they asked for is
    // worse than saying no.
    expect(normalizeHandle("reza vfx")).toBeNull();
    expect(normalizeHandle("reza@example.test")).toBeNull();
    expect(normalizeHandle("فرشاد")).toBeNull();
    expect(normalizeHandle(".reza")).toBeNull();
    expect(normalizeHandle("reza_")).toBeNull();
    expect(normalizeHandle("ab")).toBeNull();
    expect(normalizeHandle("a".repeat(HANDLE_MAX + 1))).toBeNull();
  });

  it("refuses the words the site needs for itself", () => {
    // `admin` and `support` would let somebody pass as staff in a feed that
    // shows nothing but the handle.
    expect(normalizeHandle("admin")).toBeNull();
    expect(normalizeHandle("Support")).toBeNull();
    expect(normalizeHandle("deev")).toBeNull();
    // A route name, because /profile/<handle> is the obvious next page.
    expect(normalizeHandle("settings")).toBeNull();
  });
});

describe("minting one for an account nobody asked", () => {
  const valid = (handle: string) => expect(normalizeHandle(handle)).toBe(handle);

  it("keeps an email local part that is already a handle", () => {
    expect(mintHandle("mahbodtavassoli")).toBe("mahbodtavassoli");
    valid(mintHandle("mahbodtavassoli"));
  });

  it("always returns something its own validator accepts", () => {
    // OAuth and the phone code have no form to ask on, and the column is NOT
    // NULL, so this one is not allowed to fail.
    for (const seed of ["", "!!", "a", "..", "_", "admin", "فرشاد", "x".repeat(60), "Some.One+tag"]) {
      valid(mintHandle(seed));
    }
  });

  it("leaves room for the suffix a collision needs", () => {
    const long = mintHandle("x".repeat(60), "7f3a");
    expect(long).toHaveLength(HANDLE_MAX);
    expect(long.endsWith("7f3a")).toBe(true);
    valid(long);
  });

  it("does not mint a reserved word out of a reserved seed", () => {
    expect(mintHandle("admin")).not.toBe("admin");
    valid(mintHandle("admin"));
  });

  it("pads a seed too short to be a handle", () => {
    expect(mintHandle("a".slice(0, HANDLE_MIN - 2)).length).toBeGreaterThanOrEqual(HANDLE_MIN);
    valid(mintHandle("a"));
  });
});
