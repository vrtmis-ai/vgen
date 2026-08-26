import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../lib/i18n";
import { effectiveUsd, toman } from "../data/plans";
import { PLAN_LADDER } from "../data/planLadder";
import Landing, { HERO_MODEL_IDS } from "./Landing";
import { hasModelMark } from "../components/ModelMark";
import { CatalogProvider } from "../features/catalog/CatalogProvider";
import { ContentProvider } from "../features/content/ContentProvider";
import { createDemoCatalogService } from "../adapters/demo/catalog";
import { createDemoContentService } from "../adapters/demo/content";
import { createDemoCommunityService } from "../adapters/demo/community";
import type { CatalogSnapshot } from "../runtime/contracts/catalog";

// The landing page's feature bento renders nine effects, three courses, a voice
// count and two family counts — all served now rather than imported. The demo
// services are the same committed snapshots the app uses with no backend, so
// these tests read what a visitor with no session actually gets.
const content = await createDemoContentService(() => 0).list();
const catalog = await createDemoCatalogService(() => 0).list();
const { posts } = await createDemoCommunityService().list();

function withProviders(ui: React.ReactNode, families: CatalogSnapshot["families"] = catalog.families) {
  return (
    <LanguageProvider initialLang="en">
      <CatalogProvider families={families}>
        <ContentProvider content={content}>{ui}</ContentProvider>
      </CatalogProvider>
    </LanguageProvider>
  );
}

// English, so the button assertions below read as the labels a reviewer sees.
// This used to be seeded through localStorage; language now arrives as a prop
// from the server, which is what lets <html dir> be correct in the first byte.
describe("Landing authentication actions", () => {
  it("renders the DEEV product name", () => {
    render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    expect(within(screen.getByRole("banner")).getByText("DEEV")).toBeInTheDocument();
  });

  it("keeps sign in and sign up as distinct actions", async () => {
    const user = userEvent.setup();
    const onSignIn = vi.fn();
    const onSignUp = vi.fn();

    render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={onSignIn} onSignUp={onSignUp} />));

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
    render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

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
    render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

    for (const family of bandOnly) expect(screen.getAllByText(family.name).length).toBeGreaterThan(0);
  });

  it("drops a family the catalogue stops serving, without a deploy", () => {
    // The whole point of #55, applied to this row: retire a family in the
    // database and it leaves the page. Reading the bundled list, it did not.
    const retired = bandOnly[0]!;

    const first = render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));
    expect(screen.getAllByText(retired.name).length).toBeGreaterThan(0);
    first.unmount();

    render(
      withProviders(
        <Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />,
        catalog.families.filter((family) => family.id !== retired.id),
      ),
    );

    expect(screen.queryByText(retired.name)).not.toBeInTheDocument();
  });
});

describe("Landing feature bento", () => {
  it("puts the product features before the showcase", () => {
    const { container } = render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

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
    render(withProviders(<Landing plans={PLAN_LADDER} posts={posts} onSignIn={vi.fn()} onSignUp={vi.fn()} />));

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
