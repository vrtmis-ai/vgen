import { KieGenerationProvider } from "./kie";
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
 */
export function createGenerationProvider(code: string, options: ProviderOptions = {}): GenerationProvider | null {
  if (code === "kie") return new KieGenerationProvider(options);
  return null;
}

export { KieGenerationProvider, describeOutput } from "./kie";
export { ProviderTransportError } from "./types";
export type { GenerationOutcome, GenerationOutput, GenerationProvider, GenerationRequest, GenerationSubmission, Modality } from "./types";
