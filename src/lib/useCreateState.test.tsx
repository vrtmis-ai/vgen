import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { RefMap } from "../components/controls";
import type { Family } from "../data/models";
import { useCreateState } from "./useCreateState";

/* ---------------------------------------------------------------------------
   `ready` is the create button.

   Everything else this hook holds is a value on screen; this one decides
   whether the customer can spend at all. It was computed against a hardcoded
   empty reference map, so a model with a `required` slot — Recraft and Topaz,
   both of which do nothing without a picture — reported `reference_required`
   however many files had been attached, and the button stayed dead for as long
   as the model stayed selected. No surface said why, because as far as the
   surfaces knew, nothing was wrong.
   --------------------------------------------------------------------------- */

const family: Family = {
  id: "recraft-like",
  name: "Recraft",
  vendor: "Vendor",
  kind: "image",
  minTier: 1,
  blurb: "",
  grad: "linear-gradient(#000,#111)",
  maxPrompt: 200,
  variants: [{ id: "v1", featureCode: "image_to_image", label: "V1" }],
  refs: [{ key: "image", label: "تصویر ورودی", max: 1, media: "image", required: true }],
  controls: [{ kind: "segment", key: "style", label: "Style", def: "any", options: [{ value: "any", label: "Any" }] }],
};

// The hook reads `useIsMutating`, which needs a client. `useAccess` has a
// permissive default and needs no provider.
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const attached = (): RefMap => ({ image: [{ file: new File(["png"], "in.png", { type: "image/png" }), url: "blob:in" }] });

/** The hook with a prompt already typed, which is the state a create button is pressed from. */
function prompted(refs?: RefMap) {
  const { result } = renderHook(() => useCreateState([family], refs), { wrapper });
  act(() => result.current.setPrompt("a small red boat"));
  return result;
}

const codes = (result: ReturnType<typeof prompted>) => result.current.validation.issues.map((issue) => issue.code);

describe("the create surface's readiness", () => {
  it("holds a required input against the button", () => {
    const result = prompted();
    expect(codes(result)).toContain("reference_required");
    expect(result.current.ready).toBe(false);
  });

  it("counts a file the surface has actually attached", () => {
    const result = prompted(attached());
    expect(codes(result)).toEqual([]);
    expect(result.current.validation.valid).toBe(true);
    /* `ready` is still false here, and correctly so: this family is invented
       for the test and nothing prices it, so `price` is null. Validity is what
       the fix moved — the price gate was never the thing keeping Recraft's
       button dead. */
  });

  // The point is that the file satisfies one requirement, not that it waves
  // the rest through — otherwise the fix is "always ready" wearing a disguise.
  it("still refuses when the prompt is empty", () => {
    const { result } = renderHook(() => useCreateState([family], attached()), { wrapper });
    expect(result.current.validation.issues.map((issue) => issue.code)).toContain("prompt_required");
    expect(result.current.ready).toBe(false);
  });
});
