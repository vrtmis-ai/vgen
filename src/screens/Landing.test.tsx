import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { effectiveUsd, toman } from "../data/plans";
import { PLAN_LADDER } from "../data/planLadder";
import Landing, { HERO_MODEL_IDS } from "./Landing";
import { hasModelMark } from "../components/ModelMark";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { PlansProvider } from "../features/plans/PlansProvider";
import { ContentProvider } from "../features/content/ContentProvider";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { createDemoContentService } from "../adapters/demo/content";
import type { CatalogSnapshot } from "../runtime/contracts/catalog";

/** The header's model menus route with the App Router, which no test mounts. */
const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));

// The landing page's feature bento renders nine effects, three courses, a voice
// count and two family counts — all served now rather than imported. The demo
// services are the same committed snapshots the app uses with no backend, so
// these tests read what a visitor with no session actually gets.
const content = await createDemoContentService(() => 0).list();
const catalog = await createDemoCatalogService(() => 0).list();

/**
 * Deliberately not the seed constant: the landing page prices in Toman at the
 * rate `GET /plans` served, and a number that appears nowhere in the bundle is
 * what tells that apart from a card still reading a compiled-in one.
 */
const RATE = 250_000;

function withProviders(ui: React.ReactNode, families: CatalogSnapshot["families"] = catalog.families) {
  return (
    <LanguageProvider initialLang="en">
      <PlansProvider plans={PLAN_LADDER} tomanPerUsd={RATE}>
        <CatalogProvider families={families}>
          <ContentProvider content={content}>{ui}</ContentProvider>
        </CatalogProvider>
      </PlansProvider>
    </LanguageProvider>
  );
}

// English, so the button assertions below read as the labels a reviewer sees.
// This used to be seeded through localStorage; language now arrives as a prop
// from the server, which is what lets <html dir> be correct in the first byte.
describe("Landing authentication actions", () => {
  /* The name is drawn now rather than set — the header carries the traced
     lockup — so what has to hold is that the brand is still announced, and
     still the way back to the top. A logo with no accessible name is a button
     a screen reader calls "button". */
  it("names the product in its header, mark or no mark", () => {
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    expect(within(screen.getByRole("banner")).getByRole("button", { name: "DEEV" })).toBeInTheDocument();
  });

  it("opens the same model menus the app's bar opens", async () => {
    // The landing page does not render TopBar — it is its own header, outside
    // `(nav)/layout.tsx` — so the menus have to be wired here separately, and
    // this is the test that says so. They were missing here once already.
    const user = userEvent.setup();
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    const header = within(screen.getByRole("banner"));
    await user.hover(header.getByRole("button", { name: "Video" }));

    expect(header.getByText("Text to video")).toBeInTheDocument();

    // The rows are the served catalogue's video families, not a list written
    // here. `getAllBy`, because a family that carries several feature codes gets
    // a row in each column it answers to — Kling appears under both text-to-video
    // and image-to-video, and that repetition is the point rather than a fault.
    const served = catalog.families.filter((family) => family.kind === "video");
    expect(served.length).toBeGreaterThan(0);
    for (const family of served) expect(header.getAllByText(family.name).length).toBeGreaterThan(0);
  });

  it("gives the panel a control that opens it without a pointer", async () => {
    // `fireEvent`, not `userEvent`: userEvent moves a pointer onto the element
    // before pressing it, which opens the panel by hover and makes the press a
    // close. What is under test here is the keyboard path, where no hover
    // happens and the button is the only way in.
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    const header = within(screen.getByRole("banner"));
    const disclosure = header.getByRole("button", { name: "Video models" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(header.getByText("Text to video")).toBeInTheDocument();

    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the item itself a destination rather than only a menu", async () => {
    const user = userEvent.setup();
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    await user.click(within(screen.getByRole("banner")).getByRole("button", { name: "Video" }));

    expect(nav.push).toHaveBeenCalledWith("/studio/video");
  });

  it("sends a model picked from the header menu to its generate route", async () => {
    const user = userEvent.setup();
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    const header = within(screen.getByRole("banner"));
    await user.hover(header.getByRole("button", { name: "Video" }));

    const first = catalog.families.find((family) => family.kind === "video");
    await user.click(header.getAllByText(first!.name)[0]!);

    expect(nav.push).toHaveBeenCalledWith(`/generate/${first!.id}`);
  });

  it("keeps sign in and sign up as distinct actions", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();

    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={onSignIn} onSignUp={onSignUp} />));

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
    // Against the served catalogue, which is what this test's own docstring in
    // Landing.tsx has always claimed. It read `FAMILIES` — the bundled copy — so
    // an id retired in the database passed here and then rendered nothing.
    const missing = HERO_MODEL_IDS.filter((id) => !catalog.families.some((f) => f.id === id));

    expect(missing).toEqual([]);
  });

  it("shows every one of them to the visitor", () => {
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    for (const id of HERO_MODEL_IDS) {
      const family = catalog.families.find((f) => f.id === id)!;
      expect(screen.getAllByText(family.name).length).toBeGreaterThan(0);
    }
  });
});

/**
 * The logo band under the hero, which is a different row from the one above:
 * that one is nine names chosen by hand, this one is every family that resolves
 * to a real logo, video first.
 *
 * It had no test at all, which is how it stayed on the bundled `FAMILIES` while
 * #55 moved the rest of the page to the served catalogue.
 */
describe("Landing logo band", () => {
  /** Marked, and not already in the hand-picked row above, so what these assert
   *  is the band itself rather than the other row that shares the page. */
  const bandOnly = catalog.families.filter((family) => hasModelMark(family.id, family.vendor) && !HERO_MODEL_IDS.includes(family.id));

  it("carries the served families that resolve to a logo", () => {
    expect(bandOnly.length).toBeGreaterThan(0);
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    for (const family of bandOnly) expect(screen.getAllByText(family.name).length).toBeGreaterThan(0);
  });

  it("drops a family the catalogue stops serving, without a deploy", () => {
    // The whole point of #55, applied to this row: retire a family in the
    // database and it leaves the page. Reading the bundled list, it did not.
    const retired = bandOnly[0]!;

    const first = render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));
    expect(screen.getAllByText(retired.name).length).toBeGreaterThan(0);
    first.unmount();

    render(
      withProviders(
        <Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />,
        catalog.families.filter((family) => family.id !== retired.id),
      ),
    );

    expect(screen.queryByText(retired.name)).not.toBeInTheDocument();
  });
});

describe("Landing feature bento", () => {
  it("stands on its own, with every card the bento promises", () => {
    const { container } = render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    const features = container.querySelector("#features");

    expect(features).toBeInTheDocument();

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
    render(withProviders(<Landing plans={PLAN_LADDER} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    const personal = PLAN_LADDER.filter((plan) => plan.group === "entry").sort((a, b) => a.monthlyUsd - b.monthlyUsd);
    const professional = PLAN_LADDER.filter((plan) => plan.group === "main").sort((a, b) => a.monthlyUsd - b.monthlyUsd);

    for (const plan of personal) {
      expect(screen.getByTestId(`plan-card-${plan.code}`)).toHaveTextContent(plan.name);
    }
    for (const plan of professional) {
      expect(screen.queryByTestId(`plan-card-${plan.code}`)).not.toBeInTheDocument();
    }

    const personalGrid = screen.getByTestId("landing-plan-grid");
    expect(personalGrid).toHaveAttribute("dir", "rtl");
    expect(
      within(personalGrid)
        .getAllByTestId(/plan-card-/)
        .map((card) => card.dataset.testid),
    ).toEqual(personal.map((plan) => `plan-card-${plan.code}`));

    const cheapest = [...PLAN_LADDER].sort((a, b) => effectiveUsd(a, false) - effectiveUsd(b, false))[0]!;
    const cheapestCard = screen.getByTestId(`plan-card-${cheapest.code}`);
    expect(cheapestCard).toHaveTextContent(toman(effectiveUsd(cheapest, false), RATE).toLocaleString("en-US"));
    // The cheapest plan is a pack: it buys coins that never expire, so its
    // button cannot promise thirty days of anything.
    expect(cheapest.termDays).toBe(0);
    expect(within(cheapestCard).getByRole("button", { name: "Buy the pack" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Professional plans" }));

    for (const plan of professional) {
      expect(screen.getByTestId(`plan-card-${plan.code}`)).toHaveTextContent(plan.name);
    }
    for (const plan of personal) {
      expect(screen.queryByTestId(`plan-card-${plan.code}`)).not.toBeInTheDocument();
    }
    /* The unlimited pipe is named on the plans that carry it, with the models
       it applies to read from the catalogue rather than typed into the page —
       and never as a daily quota, which is not what is being sold. */
    for (const plan of professional.filter((candidate) => candidate.tier >= 2)) {
      const card = within(screen.getByTestId(`plan-card-${plan.code}`));
      expect(card.getByText(plan.code === "pro" ? /7 days of unlimited/i : /Unlimited image generation/i)).toBeInTheDocument();
      expect(card.getAllByText(/Nano Banana/).length).toBeGreaterThan(0);
    }
    /* The pipe is not a daily quota, and the cards must not put a number of
       free generations per day on it — the claim this page used to carry. */
    for (const plan of professional) {
      expect(screen.getByTestId(`plan-card-${plan.code}`)).not.toHaveTextContent(/\d+\s*(?:free\s*)?(?:daily|روزانه)/i);
    }

    await user.click(screen.getByRole("button", { name: "Yearly" }));
    for (const plan of professional) {
      expect(within(screen.getByTestId(`plan-card-${plan.code}`)).getByRole("button", { name: "Buy 12 months" })).toBeInTheDocument();
    }
  });
});
