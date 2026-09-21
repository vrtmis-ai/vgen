import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Plan } from "../../runtime/contracts/plans";

interface PlanLadder {
  plans: readonly Plan[];
  /** What a dollar costs today, from `GET /plans`. See `toman()`. */
  tomanPerUsd: number;
}

const PlansContext = createContext<PlanLadder | null>(null);

/**
 * The served plan ladder, handed down the tree.
 *
 * A context for the same reason the access gate is one: the ladder is needed by
 * the plans screen, by the padlock five levels below a picker row, and by the
 * landing page's price cards, and threading it through Studio and FormPanel
 * would put a billing parameter on components with no other interest in
 * billing.
 */
export function PlansProvider({ plans, tomanPerUsd, children }: PlanLadder & { children: ReactNode }) {
  // Memoised on the two values rather than rebuilt each render: this context
  // sits above the whole product tree, and a fresh object every render would
  // re-render every consumer of it on every parent render.
  const ladder = useMemo(() => ({ plans, tomanPerUsd }), [plans, tomanPerUsd]);
  return <PlansContext.Provider value={ladder}>{children}</PlansContext.Provider>;
}

/**
 * Throws rather than falling back to the committed snapshot.
 *
 * A fallback would be the bug this port exists to remove: a screen quoting a
 * price the database has since changed, and doing it silently. Everything that
 * calls this sits under a gate that has already waited for `GET /plans`.
 */
export function usePlanLadder(): readonly Plan[] {
  return useLadder().plans;
}

/**
 * Toman per dollar, as the API served it today.
 *
 * A hook rather than a constant because the rate is fetched from the market
 * daily — see `apps/worker/src/fxRefresh.ts`. The constant it replaces was set
 * by hand in July and was 28% low by September, which meant every plan card
 * quoted a price the checkout would not have charged.
 */
export function useTomanPerUsd(): number {
  return useLadder().tomanPerUsd;
}

function useLadder(): PlanLadder {
  const ladder = useContext(PlansContext);
  if (!ladder) throw new Error("The plan ladder is not available. Wrap the screen in PlansProvider.");
  return ladder;
}
