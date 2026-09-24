import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FAMILIES } from "../data/models";
import { LanguageProvider } from "../lib/i18n";
import { SessionProvider, type Session } from "../runtime/providers/SessionProvider";
import Generate, { type Reuse } from "./Generate";

/* ---------------------------------------------------------------------------
   "دوباره بساز" — running one of your own generations again.

   It used to open the model with the prompt and nothing else, which is a
   different generation at the same price: the variant reverted to the family's
   first, every setting reverted to its default, and the file the generation was
   actually run against was dropped on the floor. For a first-frame video model
   that is the whole subject of the picture gone.

   Three claims, and each of them was false before:
     · the variant is the one that ran, not the family's default
     · the settings are the ones that ran, merged over the defaults so a control
       the original never set still has one
     · the file it ran against arrives attached, and can be taken off again
   --------------------------------------------------------------------------- */

// The catalogue itself rather than the demo snapshot: this screen takes a
// `Family`, and the snapshot's is a structurally similar but separate type.
const family = FAMILIES.find((candidate) => candidate.variants.length > 1 && candidate.kind === "video")!;
const original = family.variants[family.variants.length - 1]!;

const ACCOUNT: Session = {
  user: { id: "u1", methods: [], emailNormalized: "someone@example.com", handle: "someone" },
  wallet: { spendable: 500, grants: [], tier: 3 },
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

function show(reuse?: Reuse) {
  return render(
    <LanguageProvider initialLang="fa">
      <SessionProvider value={ACCOUNT}>
        <Generate family={family} reuse={reuse} onBack={vi.fn()} onGenerate={vi.fn(async () => null)} />
      </SessionProvider>
    </LanguageProvider>,
  );
}

describe("generate again", () => {
  it("selects the variant that actually ran, not the family's first", () => {
    // Guard: the default really is a different one, or this proves nothing.
    expect(family.variants[0]!.id).not.toBe(original.id);
    expect(family.variants[0]!.label).not.toBe(original.label);

    show({ jobId: "job-1", variantId: original.id, input: {}, references: [] });

    const chip = screen.getByRole("button", { name: new RegExp(original.label), pressed: true });
    expect(chip).toBeInTheDocument();
  });

  it("attaches the file the generation ran against", () => {
    const slot = original.refs?.[0] ?? family.refs?.[0];
    // Only meaningful on a model that takes one; the catalogue's video families do.
    expect(slot).toBeDefined();

    show({
      jobId: "job-1",
      variantId: original.id,
      input: {},
      references: [{ slot: slot!.key, assetId: "asset-1", url: "blob:first-frame", kind: "image", label: "از تولید قبلی" }],
    });

    expect(screen.getByTitle(/از تولید قبلی/)).toBeInTheDocument();
    // Removable: arriving with an attachment you did not ask for and cannot
    // take off is worse than arriving with none.
    expect(screen.getByRole("button", { name: /حذف از تولید قبلی/ })).toBeInTheDocument();
  });

  it("ignores a reference whose slot this variant does not have", () => {
    show({
      jobId: "job-1",
      variantId: original.id,
      input: {},
      references: [{ slot: "a_slot_no_model_declares", assetId: "asset-1", url: "blob:x", kind: "image", label: "از تولید قبلی" }],
    });

    expect(screen.queryByTitle(/از تولید قبلی/)).not.toBeInTheDocument();
  });
});
