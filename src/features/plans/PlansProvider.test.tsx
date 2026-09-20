import { render, screen } from "@testing-library/react";
import { Component, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlansProvider, usePlanLadder } from "./PlansProvider";
import { AccessProvider, useAccess } from "../../lib/access";
import { PLAN_LADDER } from "../../data/planLadder";
import type { Plan } from "../../runtime/contracts/plans";

class ExpectedErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null };
  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }
  render() {
    return this.state.message ? <span>{this.state.message}</span> : this.props.children;
  }
}

function renderExpectingFailure(node: ReactNode) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const suppress = (event: ErrorEvent) => event.preventDefault();
  window.addEventListener("error", suppress);
  try {
    render(<ExpectedErrorBoundary>{node}</ExpectedErrorBoundary>);
  } finally {
    window.removeEventListener("error", suppress);
  }
}

function LadderNames() {
  return (
    <span>
      {usePlanLadder()
        .map((plan) => plan.code)
        .join(",")}
    </span>
  );
}

/** All the gate answers now: what this plan is worth to the perks. */
function Gate() {
  const access = useAccess();
  return <span>{`${access.planId ?? "-"}:${access.tier}`}</span>;
}

/** Nothing here asserts a price; the provider just needs a rate to hold. */
const RATE = 250_000;

describe("PlansProvider", () => {
  it("hands the served ladder down, in the order it arrived", () => {
    render(
      <PlansProvider plans={PLAN_LADDER} tomanPerUsd={RATE}>
        <LadderNames />
      </PlansProvider>,
    );
    expect(screen.getByText(PLAN_LADDER.map((plan) => plan.code).join(","))).toBeInTheDocument();
  });

  // A fallback to the committed copy is exactly the bug this port removes: a
  // screen quoting a price the database has since changed, and doing it quietly.
  it("fails loudly rather than falling back to a compiled-in ladder", () => {
    renderExpectingFailure(<LadderNames />);
    expect(screen.getByText(/plan ladder is not available/)).toBeInTheDocument();
  });
});

/* There was a padlock here, and its three tests went with it: a family's
   `minTier` no longer decides who may run it, so "may I" has one answer and it
   is yes. What the tier still decides is the unlimited pipe, and the only
   thing this provider has left to get right is which tier it reports. */
describe("what a plan is worth, on the served ladder", () => {
  const gate = (planId: string | null, tier?: Plan["tier"], plans: readonly Plan[] = PLAN_LADDER) =>
    render(
      <PlansProvider plans={plans} tomanPerUsd={RATE}>
        <AccessProvider planId={planId} {...(tier ? { tier } : {})} onUpgrade={vi.fn()}>
          <Gate />
        </AccessProvider>
      </PlansProvider>,
    );

  it("reads an account with no plan as tier 1", () => {
    gate(null);
    expect(screen.getByText("-:1")).toBeInTheDocument();
  });

  it("falls back to the ladder's tier for a plan it can find", () => {
    const flagship = PLAN_LADDER.find((plan) => plan.tier === 3)!;
    gate(flagship.code);
    expect(screen.getByText(`${flagship.code}:3`)).toBeInTheDocument();
  });

  /**
   * The wallet wins, and this is the case that says why: the server reports
   * the tier *for the perk*, which drops to 1 the moment a plan's unlimited
   * window closes. Deriving it from the ladder instead would leave the free
   * switch on the dock for the rest of the term, labelling a metered
   * generation free until the quote came back with a price.
   */
  it("takes the wallet's tier over the ladder's", () => {
    const flagship = PLAN_LADDER.find((plan) => plan.tier === 3)!;
    gate(flagship.code, 1);
    expect(screen.getByText(`${flagship.code}:1`)).toBeInTheDocument();
  });
});
