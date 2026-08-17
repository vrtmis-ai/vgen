import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { FAMILIES } from "../data/models";
import { PLAN_LADDER } from "../data/planLadder";
import Landing, { HERO_MODEL_IDS } from "./Landing";

// English, so the button assertions below read as the labels a reviewer sees.
// This used to be seeded through localStorage; language now arrives as a prop
// from the server, which is what lets <html dir> be correct in the first byte.
describe("Landing authentication actions", () => {
  it("renders the DEEV product name", () => {
    render(
      <LanguageProvider initialLang="en">
        <Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    expect(within(screen.getByRole("banner")).getByText("DEEV")).toBeInTheDocument();
  });

  it("keeps sign in and sign up as distinct actions", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();

    render(
      <LanguageProvider initialLang="en">
        <Landing plans={PLAN_LADDER} onSignIn={onSignIn} onSignUp={onSignUp} />
      </LanguageProvider>,
    );

    const navigation = screen.getByRole("banner");
    await user.click(within(navigation).getByRole("button", { name: "Log in" }));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).not.toHaveBeenCalled();

    await user.click(within(navigation).getByRole("button", { name: "Start free" }));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).toHaveBeenCalledOnce();
  });
});

/**
 * The hero row is picked by name out of the catalogue and then filtered to what
 * resolves, so its failure mode is silence: a typo, or a family that is renamed
 * or retired, drops that model from the row without breaking anything. Nothing
 * is thrown, no test fails, the page just quietly makes a smaller promise.
 *
 * These assert the two halves of that — every id still names a real family, and
 * the row the visitor sees carries all nine.
 */
describe("Landing hero model row", () => {
  it("names only models the catalogue actually sells", () => {
    const missing = HERO_MODEL_IDS.filter((id) => !FAMILIES.some((f) => f.id === id));

    expect(missing).toEqual([]);
  });

  it("shows every one of them to the visitor", () => {
    render(
      <LanguageProvider initialLang="en">
        <Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    for (const id of HERO_MODEL_IDS) {
      const family = FAMILIES.find((f) => f.id === id)!;
      expect(screen.getAllByText(family.name).length).toBeGreaterThan(0);
    }
  });
});
