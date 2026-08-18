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

/** The two questions every padlock asks: may I, and what would let me. */
function Gate({ familyId }: { familyId: string }) {
  const access = useAccess();
  return <span>{`${access.tier}:${access.can(familyId) ? "open" : "locked"}:${access.needs(familyId)?.code ?? "-"}`}</span>;
}

describe("PlansProvider", () => {
  it("hands the served ladder down, in the order it arrived", () => {
    render(
      <PlansProvider plans={PLAN_LADDER}>
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

describe("the access gate, on the served ladder", () => {
  const gate = (planId: string | null, plans: readonly Plan[] = PLAN_LADDER) =>
    render(
      <PlansProvider plans={plans}>
        <AccessProvider planId={planId} onUpgrade={vi.fn()}>
          <Gate familyId="veo" />
        </AccessProvider>
      </PlansProvider>,
    );

  it("reads an account with no plan as tier 1, and points a lock at what unlocks it", () => {
    gate(null);
    // Veo is a flagship family, so tier 1 cannot run it and the lock has to name
    // the cheapest plan that can — never a tier, which tells a buyer nothing.
    const cheapest = PLAN_LADDER.filter((plan) => plan.tier >= 3).sort((a, b) => a.monthlyUsd - b.monthlyUsd)[0]!;
    expect(screen.getByText(`1:locked:${cheapest.code}`)).toBeInTheDocument();
  });

  it("unlocks the family once the plan's tier clears it", () => {
    const flagship = PLAN_LADDER.find((plan) => plan.tier === 3)!;
    gate(flagship.code);
    expect(screen.getByText(`3:open:${flagship.code}`)).toBeInTheDocument();
  });

  /**
   * The point of reading the ladder off the route. A plan withdrawn from the
   * database must stop being offered as the way past a padlock — otherwise the
   * lock recommends something nobody can buy.
   */
  it("stops recommending a plan the server no longer serves", () => {
    const withoutFlagships = PLAN_LADDER.filter((plan) => plan.tier < 3);
    gate(null, withoutFlagships);
    expect(screen.getByText("1:locked:-")).toBeInTheDocument();
  });
});
