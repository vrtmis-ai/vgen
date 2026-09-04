import { createContext, useContext, useMemo } from "react";
import { cheapestPlanFor, minTierFor, tierForPlan } from "../data/plans";
import { usePlanLadder } from "../features/plans/PlansProvider";
import type { Plan, Tier } from "../runtime/contracts/plans";

/* ---------------------------------------------------------------------------
   Who is allowed to run what.

   `MODEL_MIN_TIER` and `minTierFor` have been in data/plans since the plan
   ladder was written, and `check-combos.ts` fails the build if any family is
   missing a tier — but nothing in the UI ever called them. A Starter account
   could open Veo. The map was a description of a rule nobody enforced.

   This is a context rather than props because the question is asked five levels
   down — the picker row, the create button, the dock chip — and threading a
   plan id through Studio, FormPanel and every dock to reach them would put a
   parameter on components that have no other interest in billing. It also means
   the next surface that needs to ask gets it for free.

   `onUpgrade` lives here too. Everywhere a lock appears the only useful action
   is "go and see the plans", and that route is owned by App.
   --------------------------------------------------------------------------- */

export interface Access {
  /** Current plan id, or null for an account that has never bought one. */
  planId: string | null;
  /** What that plan unlocks. No plan is tier 1 — see tierForPlan. */
  tier: Tier;
  /** May this account run this family? */
  can: (familyId: string) => boolean;
  /** The cheapest plan that would unlock it, for the message on the lock. */
  needs: (familyId: string) => Plan | null;
  /** Take the user to the plans screen. */
  onUpgrade: () => void;
}

const Ctx = createContext<Access>({
  planId: null,
  tier: 1,
  can: () => true,
  needs: () => null,
  onUpgrade: () => {},
});

/**
 * The ladder comes from `usePlanLadder()`, not from a file.
 *
 * Which plan unlocks a family is a fact about what is on sale, and what is on
 * sale is whatever `GET /plans` says today. Reading a compiled-in copy here
 * would mean a plan withdrawn from the database keeps being offered as the way
 * past a padlock, and the customer who buys it finds the padlock still shut.
 */
export function AccessProvider({
  planId,
  tier,
  onUpgrade,
  children,
}: {
  planId: string | null;
  /**
   * The server's answer, from `GET /wallet`, and the one that decides.
   *
   * Without it this derived a tier by matching `planId` against the published
   * ladder, which is a price list rather than a record of what an account
   * holds: a plan that is granted, withdrawn, or simply not public read as tier
   * 1 and padlocked models the server would happily have run. Optional so the
   * ladder fallback still covers a caller that has no wallet — the plans tests
   * use it — but a wallet always beats it.
   */
  tier?: Tier;
  onUpgrade: () => void;
  children: React.ReactNode;
}) {
  const plans = usePlanLadder();
  const value = useMemo<Access>(() => {
    const effective = tier ?? tierForPlan(plans, planId);
    return {
      planId,
      tier: effective,
      can: (familyId) => effective >= minTierFor(familyId),
      needs: (familyId) => cheapestPlanFor(plans, familyId),
      onUpgrade,
    };
  }, [plans, planId, tier, onUpgrade]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess(): Access {
  return useContext(Ctx);
}

/** Re-exported so callers do not need two imports to render a lock. */
export { minTierFor };
