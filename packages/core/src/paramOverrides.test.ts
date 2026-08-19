import { describe, expect, it } from "vitest";
import { applyParamOverrides, isEmptyOverrides } from "./paramOverrides";

/**
 * The translation that makes routing a model to a second provider work.
 *
 * Every case here is a way the mechanism could look like it worked and quietly
 * not: a key renamed but its value left in the old alphabet, an override that
 * mutates the params the price was hashed from, an empty table that copies when
 * it should pass through. Each one ends the same way — the provider rejects the
 * request, the job fails, and the customer is refunded for a switch somebody
 * believed had happened.
 */

describe("passing through", () => {
  it("returns the same object when there is nothing to do", () => {
    const params = { prompt: "a boat" };
    // Identity, not equality. This is the path every job on its own provider
    // takes, which is nearly all of them.
    expect(applyParamOverrides(params, {})).toBe(params);
    expect(applyParamOverrides(params, null)).toBe(params);
    expect(applyParamOverrides(params, undefined)).toBe(params);
  });

  it("knows an empty table from a populated one", () => {
    expect(isEmptyOverrides({})).toBe(true);
    expect(isEmptyOverrides(null)).toBe(true);
    expect(isEmptyOverrides({ drop: [] })).toBe(false);
  });

  it("never mutates what it was given", () => {
    // The caller's `job.params` is what the price was hashed from and what the
    // gallery shows back. Editing it in place would make the record of what was
    // asked for disagree with what was charged.
    const params = { prompt: "a boat", aspect_ratio: "16:9" };
    applyParamOverrides(params, { rename: { aspect_ratio: "size" }, drop: ["prompt"] });
    expect(params).toEqual({ prompt: "a boat", aspect_ratio: "16:9" });
  });
});

describe("rename", () => {
  it("moves the value and takes the old key with it", () => {
    expect(applyParamOverrides({ ratio: "16:9", prompt: "x" }, { rename: { ratio: "aspect_ratio" } })).toEqual({
      aspect_ratio: "16:9",
      prompt: "x",
    });
  });

  it("ignores a key that is not there", () => {
    // Params are built from the controls a customer actually touched, so an
    // optional control left alone simply has nothing to move. Treating that as
    // an error would fail a generation for a setting nobody chose.
    expect(applyParamOverrides({ prompt: "x" }, { rename: { seed: "noise_seed" } })).toEqual({ prompt: "x" });
  });

  it("survives a rename onto itself", () => {
    // The naive implementation writes the value and then deletes the key it
    // just wrote, silently dropping the parameter.
    expect(applyParamOverrides({ size: "1024*1024" }, { rename: { size: "size" } })).toEqual({ size: "1024*1024" });
  });
});

describe("map", () => {
  it("translates the value, not just the key", () => {
    // The real case from the catalogue: KIE takes a ratio string, WaveSpeed's
    // qwen-image takes width*height. Renaming alone posts "16:9" into a field
    // that parses dimensions, and every generation on that route fails.
    expect(
      applyParamOverrides(
        { prompt: "x", aspect_ratio: "16:9" },
        { rename: { aspect_ratio: "size" }, map: { size: { "16:9": "1344*768", "1:1": "1024*1024" } } },
      ),
    ).toEqual({ prompt: "x", size: "1344*768" });
  });

  it("is keyed on the name after renaming", () => {
    expect(applyParamOverrides({ ratio: "1:1" }, { rename: { ratio: "size" }, map: { ratio: { "1:1": "wrong" } } })).toEqual({
      size: "1:1",
    });
  });

  it("passes a value through when the table has no entry for it", () => {
    // A partial table is a partial translation. Blanking the value instead
    // would turn a missing row into a malformed request.
    expect(applyParamOverrides({ size: "21:9" }, { map: { size: { "16:9": "1344*768" } } })).toEqual({ size: "21:9" });
  });

  it("looks numbers up by their string form", () => {
    expect(applyParamOverrides({ resolution: 720 }, { map: { resolution: { "720": "720p" } } })).toEqual({ resolution: "720p" });
  });

  it("leaves objects and arrays alone", () => {
    const refs = ["https://x/a.png"];
    expect(applyParamOverrides({ image_urls: refs }, { map: { image_urls: { a: "b" } } })).toEqual({ image_urls: refs });
  });
});

describe("set and drop", () => {
  it("set wins over what is already there", () => {
    expect(applyParamOverrides({ output_format: "jpeg" }, { set: { output_format: "png" } })).toEqual({ output_format: "png" });
  });

  it("drop runs last, so a renamed key can still be dropped", () => {
    expect(applyParamOverrides({ ratio: "16:9", prompt: "x" }, { rename: { ratio: "size" }, drop: ["size"] })).toEqual({ prompt: "x" });
  });

  it("drop beats set, because it is last", () => {
    // Stated as a test because the order is the whole specification and a
    // refactor that reorders these two changes what every route does.
    expect(applyParamOverrides({}, { set: { seed: 1 }, drop: ["seed"] })).toEqual({});
  });

  it("applies the whole chain in order", () => {
    expect(
      applyParamOverrides(
        { prompt: "a boat", aspect_ratio: "1:1", seed: 42 },
        {
          rename: { aspect_ratio: "size" },
          map: { size: { "1:1": "1024*1024" } },
          set: { output_format: "png" },
          drop: ["seed"],
        },
      ),
    ).toEqual({ prompt: "a boat", size: "1024*1024", output_format: "png" });
  });
});
