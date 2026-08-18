import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { FAMILIES } from "../data/models";
import { effectiveUsd, toman } from "../data/plans";
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
    await user.click(within(navigation).getByTestId("landing-login"));

    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignUp).not.toHaveBeenCalled();

    await user.click(within(navigation).getByTestId("landing-signup"));

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

describe("Landing feature bento", () => {
  it("puts the product features before the showcase", () => {
    const { container } = render(
      <LanguageProvider initialLang="en">
        <Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    const features = container.querySelector("#features");
    const showcase = container.querySelector("#showcase");

    expect(features).toBeInTheDocument();
    expect(showcase).toBeInTheDocument();
    expect(features!.compareDocumentPosition(showcase!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const featureSection = within(features as HTMLElement);
    expect(featureSection.queryByRole("navigation")).not.toBeInTheDocument();
    expect(featureSection.getAllByRole("heading")).toHaveLength(8);
    for (const feature of ["video", "image", "voice", "effects", "academy", "studio", "mcp"]) {
      expect(featureSection.getByTestId(`feature-card-${feature}`)).toBeInTheDocument();
    }
  });
});

describe("Landing pricing", () => {
  it("separates personal and professional plans while keeping the cheapest plan first in RTL", async () => {
    const user = userEvent.setup();
    render(
      <LanguageProvider initialLang="en">
        <Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />
      </LanguageProvider>,
    );

    const personal = PLAN_LADDER.filter((plan) => plan.group === "entry").sort((a, b) => a.monthlyUsd - b.monthlyUsd);
    const professional = PLAN_LADDER.filter((plan) => plan.group === "main").sort((a, b) => a.monthlyUsd - b.monthlyUsd);

    for (const plan of personal) {
      expect(screen.getByTestId(`landing-plan-${plan.code}`)).toHaveTextContent(plan.name);
    }
    for (const plan of professional) {
      expect(screen.queryByTestId(`landing-plan-${plan.code}`)).not.toBeInTheDocument();
    }

    const personalGrid = screen.getByTestId("landing-plan-grid");
    expect(personalGrid).toHaveAttribute("dir", "rtl");
    expect(
      within(personalGrid)
        .getAllByTestId(/landing-plan-/)
        .map((card) => card.dataset.testid),
    ).toEqual(personal.map((plan) => `landing-plan-${plan.code}`));

    const cheapest = [...PLAN_LADDER].sort((a, b) => effectiveUsd(a, false) - effectiveUsd(b, false))[0]!;
    const cheapestCard = screen.getByTestId(`landing-plan-${cheapest.code}`);
    expect(cheapestCard).toHaveTextContent(toman(effectiveUsd(cheapest, false)).toLocaleString("en-US"));
    expect(within(cheapestCard).getByRole("button", { name: "Buy 30 days" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Professional plans" }));

    for (const plan of professional) {
      expect(screen.getByTestId(`landing-plan-${plan.code}`)).toHaveTextContent(plan.name);
    }
    for (const plan of personal) {
      expect(screen.queryByTestId(`landing-plan-${plan.code}`)).not.toBeInTheDocument();
    }
    expect(screen.getAllByText("Unlimited Generation")).toHaveLength(2);
    expect(screen.getAllByText("Nano Banana Pro · Nano Banana 2")).toHaveLength(2);
    expect(document.body).not.toHaveTextContent(/(?:50|۵۰).*(?:daily|روزانه)/i);

    await user.click(screen.getByRole("button", { name: "Yearly" }));
    for (const plan of professional) {
      expect(within(screen.getByTestId(`landing-plan-${plan.code}`)).getByRole("button", { name: "Buy 12 months" })).toBeInTheDocument();
    }
  });
});
