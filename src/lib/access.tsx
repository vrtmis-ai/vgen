import { createContext, useContext, useMemo } from "react";
import { usePlanLadder } from "../features/plans/PlansProvider";
import { tierForPlan } from "../data/plans";
import type { Tier } from "../runtime/contracts/plans";

/* ---------------------------------------------------------------------------
   What this account's plan is worth.

   It used to answer "may this account run this model": every family declared a
   `minTier`, every plan a tier, and a padlock appeared wherever the second was
   below the first. That gate is gone — on the owner's decision, 2026-09-20, no
   model is locked to a plan. Anyone may run anything they can pay for, and
   what stops an unaffordable generation is the price against the balance, in
   `useCreateState`.

   What is left is the one perk still decided by a tier: the unlimited pipe.
   The tier here comes from the wallet, which reports the tier *for that perk* —
   a plan whose unlimited window has closed reads as 1, so the free switch
   leaves the dock on the day the quote stops coming back free.

   Still a context rather than a prop because the question is asked five levels
   down, and `onUpgrade` lives here because everywhere the answer is "your plan
   does not carry this" the only useful action is to go and see the plans.
   --------------------------------------------------------------------------- */

export interface Access {
  /** Current plan id, or null for an account that has never bought one. */
  planId: string | null;
  /** What that plan is worth to the unlimited pipe. No plan is tier 1. */
  tier: Tier;
  /** Take the user to the plans screen. */
  onUpgrade: () => void;
}

const Ctx = createContext<Access>({
  planId: null,
  tier: 1,
  onUpgrade: () => {},
});

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
   * holds: a plan that is granted, withdrawn, or simply not public read as
   * tier 1. Optional so the ladder fallback still covers a caller that has no
   * wallet — the plans tests use it — but a wallet always beats it.
   */
  tier?: Tier;
  onUpgrade: () => void;
  children: React.ReactNode;
}) {
  const plans = usePlanLadder();
  const value = useMemo<Access>(() => ({ planId, tier: tier ?? tierForPlan(plans, planId), onUpgrade }), [plans, planId, tier, onUpgrade]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccess(): Access {
  return useContext(Ctx);
}
