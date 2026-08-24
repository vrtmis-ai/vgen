import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDemoServices } from "../adapters/demo/demoServices";
import { LanguageProvider } from "../lib/i18n";
import { AppServicesProvider } from "../runtime/AppServices";
import { PlansProvider } from "../features/plans/PlansProvider";
import { toman } from "../data/plans";
import { PLAN_LADDER } from "../data/planLadder";
import Plans from "./Plans";
import type { Plan } from "../runtime/contracts/plans";
import type { Wallet } from "../runtime/contracts/wallet";

const WALLET: Wallet = { spendable: 12, grants: [] };

/**
 * The screen asks for the running campaign, so it needs the service port and a
 * query client above it. Retries are off and the campaign query resolves after
 * this synchronous render, so the strip is simply absent in these cases — which
 * is the same thing a visitor sees when no campaign is running, and it keeps
 * these assertions about the ladder rather than about a banner.
 */
function show(plans: readonly Plan[], currentPlanId: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AppServicesProvider services={createDemoServices()}>
        <LanguageProvider initialLang="en">
          <PlansProvider plans={plans}>
            <Plans wallet={WALLET} currentPlanId={currentPlanId} onBack={vi.fn()} />
          </PlansProvider>
        </LanguageProvider>
      </AppServicesProvider>
    </QueryClientProvider>,
  );
}

/**
 * The screen used to import the ladder from a file, so no test could tell the
 * difference between "prices what the server serves" and "prices what shipped in
 * the bundle". Every case below moves the served ladder and expects the screen
 * to move with it.
 */
describe("the plans screen", () => {
  it("prices from the ladder it was handed, not from a compiled-in copy", () => {
    const [first, ...rest] = PLAN_LADDER;
    const repriced: Plan = { ...first!, monthlyUsd: first!.monthlyUsd * 2 };
    show([repriced, ...rest]);

    expect(screen.getAllByText(String(toman(repriced.monthlyUsd)).replace(/\B(?=(\d{3})+(?!\d))/g, ","))[0]).toBeInTheDocument();
  });

  it("sells only the plans the server still serves", () => {
    const [withdrawn, ...remaining] = PLAN_LADDER;
    show(remaining);

    expect(screen.queryByText(withdrawn!.name)).not.toBeInTheDocument();
    for (const plan of remaining) expect(screen.getAllByText(plan.name).length).toBeGreaterThan(0);
  });

  // `coinsPerTerm` is the total, bonus included — the number to charge against.
  // The card used to add two fields together to get it, which is money
  // arithmetic in a screen.
  it("shows the term's coin total as the payload states it", () => {
    // A "main" plan: the compact entry card does not carry the bonus line.
    const plan = PLAN_LADDER.find((p) => p.group === "main" && p.bonusCoins > 0)!;
    show([plan]);

    expect(screen.getAllByText(plan.coinsPerTerm.toLocaleString("en-US")).length).toBeGreaterThan(0);
    // The bonus is stated on its own, beside the total it is already inside.
    const bonus = `${plan.bonusCoins.toLocaleString("en-US")} bonus coins`;
    expect(screen.getAllByText((_text, element) => element?.textContent?.trim() === bonus).length).toBeGreaterThan(0);
  });

  it("marks the plan the account is on, and does not offer to sell it again", () => {
    const current = PLAN_LADDER.find((plan) => plan.group === "main")!;
    show(PLAN_LADDER, current.code);

    expect(screen.getAllByText("Your current plan").length).toBeGreaterThan(0);
    // The button on that card is the disabled one — a plan you hold is not for sale.
    expect(screen.getAllByRole("button", { name: "Your current plan" })[0]).toBeDisabled();
  });
});
