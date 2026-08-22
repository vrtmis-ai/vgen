/**
 * Which upstream endpoint each catalogue variant is sent to.
 *
 * Server-only, and deliberately not a field on `Variant`: `models.ts` is
 * bundled for the browser, so an endpoint string on a variant is an endpoint
 * string published to every visitor. ESLint refuses this import from `src/`
 * and `app/` so the separation cannot quietly rot.
 */
import upstream from "../src/data/upstream.json" with { type: "json" };

const UPSTREAM = upstream as unknown as Record<string, { model: string; modelWithRefs?: string }>;

export function upstreamModel(variantId: string): string {
  const entry = UPSTREAM[variantId];
  // A variant with no endpoint cannot be seeded and must not be guessed at: a
  // wrong id here is a 404 the customer pays for.
  if (!entry) throw new Error(`No upstream endpoint for variant "${variantId}". Add it to src/data/upstream.json.`);
  return entry.model;
}

export function upstreamModelWithRefs(variantId: string): string | undefined {
  return UPSTREAM[variantId]?.modelWithRefs;
}
