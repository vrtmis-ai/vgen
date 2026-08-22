import { describe, expect, it } from "vitest";
import type { RefMap } from "../../components/controls";
import type { Family, Variant } from "../../data/models";
import { validateGenerationInput } from "./validation";
import { ApiError } from "../../adapters/http/client";
import { generationErrorMessage } from "./validation";

const variant: Variant = { id: "v1", featureCode: "image_to_video", label: "V1" };
const family: Family = {
  id: "family",
  name: "Family",
  vendor: "Vendor",
  kind: "video",
  minTier: 1,
  blurb: "",
  grad: "linear-gradient(#000,#111)",
  maxPrompt: 20,
  variants: [variant],
  refs: [{ key: "image_url", label: "Image", max: 1, media: "image", maxMb: 1, required: true }],
  controls: [
    { kind: "segment", key: "resolution", label: "Resolution", def: "720p", options: [{ value: "720p", label: "720p" }] },
    { kind: "slider", key: "duration", label: "Duration", min: 4, max: 10, step: 1, def: 5 },
    { kind: "toggle", key: "audio", label: "Audio", def: false },
  ],
};

function refs(file = new File(["image"], "input.png", { type: "image/png" })): RefMap {
  return { image_url: [{ file, url: "blob:input" }] };
}

describe("generation input validation", () => {
  it("accepts a complete request", () => {
    expect(
      validateGenerationInput({
        family,
        variant,
        prompt: "A quiet forest",
        input: { resolution: "720p", duration: 5, audio: false },
        refs: refs(),
      }),
    ).toEqual({ valid: true, issues: [] });
  });

  it("rejects prompt, enum and required-reference errors together", () => {
    const result = validateGenerationInput({
      family,
      variant,
      prompt: "",
      input: { resolution: "4k", duration: 5, audio: false },
      refs: {},
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["prompt_required", "invalid_control", "reference_required"]),
    );
  });

  it("rejects wrong MIME, excessive size and invalid duration metadata", () => {
    const wrongType = new File([new Uint8Array(1024 * 1024 + 1)], "input.mp4", { type: "video/mp4" });
    const result = validateGenerationInput({
      family,
      variant,
      prompt: "Valid",
      input: { resolution: "720p", duration: 5, audio: false },
      refs: { image_url: [{ file: wrongType, url: "blob:input", duration: -1 }] },
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["invalid_mime", "file_too_large", "invalid_duration"]),
    );
  });

  it("rejects stale controls and references from another variant", () => {
    const result = validateGenerationInput({
      family,
      variant,
      prompt: "Valid",
      input: { resolution: "720p", duration: 5, audio: false, stale_control: true },
      refs: { ...refs(), previous_slot: refs().image_url ?? [] },
    });

    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unknown_control", "unknown_reference"]));
  });
});

describe("generation error messages", () => {
  // The codes are `docs/API.md`'s, not ours. Each expectation is a word only the
  // right message contains, so a message can be reworded without touching this.
  it.each([
    ["insufficient_credits", "شارژ"],
    ["tier_too_low", "ارتقا"],
    ["allowance_spent", "رایگان"],
    ["not_offered", "ارائه نمی‌شود"],
    ["params_mismatch", "قیمت‌گیری"],
    ["concurrency_reached", "هم‌زمان"],
    ["quote_expired", "منقضی"],
    ["quote_spent", "قبلاً ثبت شده"],
    ["no_price", "از سمت ماست"],
    ["provider_unavailable", "ارائه‌دهنده"],
    ["no_output", "خروجی"],
    ["request_timeout", "طول کشید"],
    ["network_error", "اتصال اینترنت"],
  ])("maps %s to a safe actionable message", (code, expected) => {
    const error = new ApiError({ code, message: "raw provider details", status: 422 });
    expect(generationErrorMessage(error)).toContain(expected);
    expect(generationErrorMessage(error)).not.toContain("raw provider details");
  });

  it("gives a refunded job failure its own reassurance", () => {
    // Every terminal job failure releases the hold, so each of these has to say
    // the coins came back. A generic "try again" here reads as money lost.
    for (const code of [
      "provider_unavailable",
      "credential_unavailable",
      "submit_failed",
      "poll_failed",
      "provider_timeout",
      "no_output",
    ]) {
      expect(generationErrorMessage(new ApiError({ code, message: "x", status: 500 }))).toContain("کم نشد");
    }
  });

  it("does not answer to codes the API never sends", () => {
    // The bug this file now guards: these three were the whole map, and the two
    // refusals people actually hit were not in it.
    for (const code of ["insufficient_balance", "locked_model", "unsupported_combination"]) {
      expect(generationErrorMessage(new ApiError({ code, message: "x", status: 422 }))).toBe(generationErrorMessage(new Error("x")));
    }
  });
});
