import { createContext, useContext, type ReactNode } from "react";
import type { Plan } from "../../runtime/contracts/plans";

const PlansContext = createContext<readonly Plan[] | null>(null);

/**
 * The served plan ladder, handed down the tree.
 *
 * A context for the same reason the access gate is one: the ladder is needed by
 * the plans screen, by the padlock five levels below a picker row, and by the
 * landing page's price cards, and threading it through Studio and FormPanel
 * would put a billing parameter on components with no other interest in
 * billing.
 */
export function PlansProvider({ plans, children }: { plans: readonly Plan[]; children: ReactNode }) {
  return <PlansContext.Provider value={plans}>{children}</PlansContext.Provider>;
}

/**
 * Throws rather than falling back to the committed snapshot.
 *
 * A fallback would be the bug this port exists to remove: a screen quoting a
 * price the database has since changed, and doing it silently. Everything that
 * calls this sits under a gate that has already waited for `GET /plans`.
 */
export function usePlanLadder(): readonly Plan[] {
  const plans = useContext(PlansContext);
  if (!plans) throw new Error("The plan ladder is not available. Wrap the screen in PlansProvider.");
  return plans;
}
