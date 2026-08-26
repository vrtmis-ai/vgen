import type { Variant } from "../data/models";

/**
 * Whether the flat-fee pipe is reachable for a variant *as it is currently set*.
 *
 * Three answers, not two. "This model has no unlimited pipe" and "it has one but
 * not at 4K" are different things to a person deciding what to press, and
 * collapsing them into a missing switch would leave somebody who turned it on at
 * 2K wondering where it went when they reached for 4K.
 */
export type UnlimitedFit =
  /** No pipe at all. Render nothing. */
  | null
  /** Reachable. `dailyCap` is what the plan allows per day. */
  | { available: true; dailyCap: number }
  /** The pipe exists, but not under this setting. `blockedBy` is the control key. */
  | { available: false; dailyCap: number; blockedBy: string };

export function unlimitedFit(variant: Variant, input: Record<string, string | number | boolean>): UnlimitedFit {
  const pipe = variant.unlimited;
  if (!pipe) return null;

  // `limits` absent means the pipe covers every setting the variant offers.
  for (const [key, allowed] of Object.entries(pipe.limits ?? {})) {
    const chosen = input[key];
    // An unset control is not a violation: the variant's own default decides,
    // and the server prices what it is actually sent. Only a value the customer
    // picked and the pipe does not cover blocks it.
    if (chosen === undefined) continue;
    if (!allowed.includes(String(chosen))) return { available: false, dailyCap: pipe.dailyCap, blockedBy: key };
  }

  return { available: true, dailyCap: pipe.dailyCap };
}
