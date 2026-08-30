import { describe, expect, it } from "vitest";
import { coversSettings } from "./quotesRepository";
import type { GenerationParams } from "./generationRepository";

/**
 * Whether a grant reaches the settings being asked for.
 *
 * Unit rather than integration because every case here is a decision about a
 * pair of plain values, and the interesting ones — a missing param, a number
 * arriving where a string was written — are awkward to stage through a seeded
 * catalogue and trivial to state directly.
 *
 * The reason this is tested at all is that it decides whether somebody is
 * charged. A wrong `true` bills a customer who was promised free; a wrong
 * `false` charges for something we said was included. Both are money.
 */
const params = (values: Record<string, unknown>): GenerationParams => values as GenerationParams;

describe("whether an unlimited grant covers the settings asked for", () => {
  it("covers everything when the grant narrows nothing", () => {
    expect(coversSettings(null, params({ resolution: "4K" }))).toBe(true);
  });

  it("covers a value the grant names", () => {
    expect(coversSettings({ resolution: ["1K", "2K"] }, params({ resolution: "2K" }))).toBe(true);
  });

  it("does not cover a value outside the list", () => {
    expect(coversSettings({ resolution: ["1K", "2K"] }, params({ resolution: "4K" }))).toBe(false);
  });

  /**
   * A key the grant says nothing about is unconstrained.
   *
   * Otherwise adding a control to a variant would silently withdraw every grant
   * written before that control existed — the catalogue would gain an option
   * and customers would quietly start being billed for a model that had been
   * free, with nothing in the diff to suggest it.
   */
  it("ignores settings the grant does not mention", () => {
    expect(coversSettings({ resolution: ["1K"] }, params({ resolution: "1K", output_format: "png" }))).toBe(true);
  });

  /**
   * Every named key has to hold, not just one.
   */
  it("needs all of the narrowed keys to match", () => {
    const covers = { resolution: ["1K"], output_format: ["png"] };
    expect(coversSettings(covers, params({ resolution: "1K", output_format: "png" }))).toBe(true);
    expect(coversSettings(covers, params({ resolution: "1K", output_format: "jpg" }))).toBe(false);
  });

  /**
   * A missing setting is not a covered setting.
   *
   * If the pipe covers 1K and 2K and the request names no resolution, the
   * model's own default decides what runs and this code does not know what that
   * is. Guessing costs the margin when the guess is wrong, so it prices —
   * missing configuration costs a sale, never the margin, which is how the tier
   * gate resolves the same tension a few lines earlier.
   */
  it("does not cover a setting the request left out", () => {
    expect(coversSettings({ resolution: ["1K", "2K"] }, params({}))).toBe(false);
    expect(coversSettings({ resolution: ["1K", "2K"] }, params({ resolution: null }))).toBe(false);
  });

  /**
   * Control values arrive as `unknown` from a JSON body. A number that the
   * catalogue wrote as a string has to still match, or a client that sends
   * `1024` where `"1024"` was seeded gets billed for a setting the grant
   * actually covers.
   */
  it("compares by value rather than by type", () => {
    expect(coversSettings({ duration: ["5"] }, params({ duration: 5 }))).toBe(true);
    expect(coversSettings({ hd: ["true"] }, params({ hd: true }))).toBe(true);
    expect(coversSettings({ duration: ["5"] }, params({ duration: 10 }))).toBe(false);
  });

  /**
   * An empty allow-list covers nothing, which is the only reading that makes
   * sense: a grant that names a key and permits no value for it is a grant
   * withdrawn for that setting, not a grant with no opinion.
   */
  it("covers nothing for a key whose list is empty", () => {
    expect(coversSettings({ resolution: [] }, params({ resolution: "1K" }))).toBe(false);
  });
});
