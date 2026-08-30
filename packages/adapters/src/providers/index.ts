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
 * `wavespeed` was the deliberate exception to that rule. As of 2026-08-22 a real
 * key has exercised its submit path and all three of its failure modes, so the
 * request shape and the error envelope are now known rather than believed. Its
 * success path is not: the account holds $0, so no generation has completed.
 * The file says which half is which.
 *
 * That same session settled something about this rule that is worth writing
 * down. Two of the four seeded WaveSpeed paths named models that do not exist —
 * both of them the ones transcribed from a naming convention rather than read
 * off a page. Documentation specific enough to implement is still not evidence
 * that a particular model id is real, and the cheapest thing that tells you is
 * `GET /api/v3/models`, which their quickstart never mentions.
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
export type {
  GenerationOutcome,
  GenerationOutput,
  GenerationProvider,
  GenerationRequest,
  GenerationSubmission,
  JsonObject,
  JsonValue,
  Modality,
} from "./types";
