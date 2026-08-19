import { KieGenerationProvider } from "./kie";
import { WaveSpeedGenerationProvider } from "./wavespeed";
import type { GenerationProvider, Modality } from "./types";

export interface ProviderOptions {
  baseUrl?: string | undefined;
  modality?: Modality | undefined;
  fetch?: typeof globalThis.fetch | undefined;
  timeoutMs?: number | undefined;
}

/**
 * The adapter for a `providers.code`, or null when we have no way to call it.
 *
 * Null rather than a throw, and rather than a stub that pretends: the runner
 * turns it into a job failure that releases the hold and the daily allowance,
 * so a provider we cannot reach costs the customer nothing. A stub adapter
 * would have had to invent request shapes, and an invented shape that
 * typechecks is worse than an absence that does not.
 *
 * `useapi` is the null case today. The grants are seeded and the serving rows
 * exist, but their API has never been exercised — there is no token in any
 * environment we control, and the external model ids on those rows came from
 * a published list rather than from a call that returned 200. Writing the
 * adapter before a token exists would be writing it against a guess; the KIE
 * adapter is trustworthy precisely because `scripts/spike-kie.ts` spent real
 * credits proving each of its assumptions wrong or right.
 *
 * `wavespeed` is the deliberate exception to that rule and is marked as one in
 * its own file. It is written from published documentation specific enough to
 * implement, unlike useapi's, and it is safe to ship unproven only because
 * every `model_routes` row pointing at it is seeded inactive — so nothing
 * reaches it until somebody runs `scripts/spike-wavespeed.ts` with a real key
 * and turns a route on.
 */
export function createGenerationProvider(code: string, options: ProviderOptions = {}): GenerationProvider | null {
  if (code === "kie") return new KieGenerationProvider(options);
  if (code === "wavespeed") return new WaveSpeedGenerationProvider(options);
  return null;
}

export { KieGenerationProvider } from "./kie";
export { WaveSpeedGenerationProvider } from "./wavespeed";
export { describeOutput } from "./output";
export { ProviderTransportError } from "./types";
export type { GenerationOutcome, GenerationOutput, GenerationProvider, GenerationRequest, GenerationSubmission, Modality } from "./types";
