import type { Variant } from "../data/models";
import type { Tier } from "../data/plans";

/**
 * Whether the flat-fee pipe is reachable for a variant *as it is currently set*,
 * by a customer *on this plan*.
 *
 * Four answers, not two. "This model has no unlimited pipe", "it has one but
 * your plan is below it" and "it has one but not at 4K" are different things to
 * a person deciding what to press, and collapsing them into a missing switch
 * would leave somebody who turned it on at 2K wondering where it went when they
 * reached for 4K.
 *
 * The tier check is the one that costs money to get wrong. A grant's `minTier`
 * is not the family's: Nano Banana opens at tier 2 and its grant at tier 3, so a
 * Pro customer can reach the model and not the free pipe. Rendering an enabled
 * switch there would label a metered generation free — and the quote declining
 * politely, which it does, happens after the customer has already pressed.
 */
export type UnlimitedFit =
  /** No pipe at all. Render nothing. */
  | null
  /** Reachable. `dailyCap` is what the plan allows per day, null when uncapped. */
  | { available: true; dailyCap: number | null }
  /** The pipe exists, but this plan is below it. `needsTier` is what it takes. */
  | { available: false; reason: "tier"; needsTier: Tier; dailyCap: number | null }
  /** The pipe exists, but not under this setting. `blockedBy` is the control key. */
  | { available: false; reason: "setting"; blockedBy: string; dailyCap: number | null };

export function unlimitedFit(variant: Variant, input: Record<string, string | number | boolean>, tier: Tier): UnlimitedFit {
  const pipe = variant.unlimited;
  if (!pipe) return null;

  // Tier before settings: a plan that cannot have the pipe at all should not be
  // told which resolution would have worked.
  if (tier < pipe.minTier) return { available: false, reason: "tier", needsTier: pipe.minTier, dailyCap: pipe.dailyCap };

  // `limits` absent means the pipe covers every setting the variant offers.
  for (const [key, allowed] of Object.entries(pipe.limits ?? {})) {
    const chosen = input[key];
    // An unset control is not a violation: the variant's own default decides,
    // and the server prices what it is actually sent. Only a value the customer
    // picked and the pipe does not cover blocks it.
    if (chosen === undefined) continue;
    if (!allowed.includes(String(chosen))) return { available: false, reason: "setting", blockedBy: key, dailyCap: pipe.dailyCap };
  }

  return { available: true, dailyCap: pipe.dailyCap };
}
