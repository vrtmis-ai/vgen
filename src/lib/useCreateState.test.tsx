import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { RefMap } from "../components/controls";
import { FAMILIES, type Family } from "../data/models";
import { SessionProvider } from "../runtime/providers/SessionProvider";
import type { AccountUser } from "../runtime/contracts/session";
import type { Wallet } from "../runtime/contracts/wallet";
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
  refs: [{ key: "image", role: "reference", label: "تصویر ورودی", max: 1, media: "image", required: true }],
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

/* ---------------------------------------------------------------------------
   The wallet is the gate now.

   No model is locked to a plan, so the price against the balance is the only
   thing that can stop a generation before it is sent. The server still refuses
   an unaffordable one — that is what actually protects the ledger — but a
   customer should not learn it by pressing a lit button.
   --------------------------------------------------------------------------- */

/** A real, priced family out of the catalogue: an invented one has no price. */
const priced = FAMILIES.find((candidate) => candidate.id === "z-image")!;

function signedIn(spendable: number) {
  const wallet = { spendable, grants: [], tier: 1 } as unknown as Wallet;
  return function Wrapper({ children }: { children: ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <SessionProvider
          value={{
            user: { id: "u-1", email: "buyer@example.test" } as unknown as AccountUser,
            wallet,
            signIn: () => {},
            signUp: () => {},
            signOut: () => {},
          }}
        >
          {children}
        </SessionProvider>
      </QueryClientProvider>
    );
  };
}

function withBalance(spendable: number) {
  const { result } = renderHook(() => useCreateState([priced]), { wrapper: signedIn(spendable) });
  act(() => result.current.setPrompt("a small red boat"));
  return result;
}

describe("a balance that cannot cover the price", () => {
  it("is ready when the wallet covers it", () => {
    const result = withBalance(50);
    expect(result.current.price).toBeGreaterThan(0);
    expect(result.current.short).toBe(false);
    expect(result.current.ready).toBe(true);
  });

  /* `short` is reported; it is not a gate. A balance too small to cover the
     price leaves the button pressable and lets the press answer «سکه کافی
     نیست» — a dark primary control is the one thing on the dock that cannot
     say why it is dark, and on a phone there is no hover to recover that. */
  it("is short, and still ready, when it does not", () => {
    const result = withBalance(0.01);
    expect(result.current.short).toBe(true);
    expect(result.current.ready).toBe(true);
  });

  /* A visitor has no wallet to be short of. The dock turns its button into a
     sign-in rather than telling somebody with no account that they cannot
     afford something. */
  it("says nothing about a balance a visitor does not have", () => {
    const result = prompted2();
    expect(result.current.spendable).toBeNull();
    expect(result.current.short).toBe(false);
  });
});

/** The same priced family with no session above it, which is a visitor. */
function prompted2() {
  const { result } = renderHook(() => useCreateState([priced]), { wrapper });
  act(() => result.current.setPrompt("a small red boat"));
  return result;
}
