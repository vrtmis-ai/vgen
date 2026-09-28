/**
 * Which upstream endpoint each catalogue variant is sent to.
 *
 * Server-only, and deliberately not a field on `Variant`: `models.ts` is
 * bundled for the browser, so an endpoint string on a variant is an endpoint
 * string published to every visitor. ESLint refuses this import from `src/`
 * and `app/` so the separation cannot quietly rot.
 */
import upstream from "../src/data/upstream.json" with { type: "json" };

const UPSTREAM = upstream as unknown as Record<string, { model: string; provider?: string }>;

/** What every variant was, before a second provider owned one. */
const HOME_PROVIDER = "kie";

export function upstreamModel(variantId: string): string {
  const entry = UPSTREAM[variantId];
  // A variant with no endpoint cannot be seeded and must not be guessed at: a
  // wrong id here is a 404 the customer pays for.
  if (!entry) throw new Error(`No upstream endpoint for variant "${variantId}". Add it to src/data/upstream.json.`);
  return entry.model;
}

/**
 * Which provider *owns* this variant's catalogue row — not which one happens to
 * serve it today, which is what `model_routes` decides.
 *
 * Absent means `kie`, which every variant was when this file held endpoints
 * alone. It is stated per variant because some models have no KIE equivalent at
 * all: Cinema Studio, Soul, Marketing Studio and the Kling Omni pair exist on
 * Higgsfield and nowhere else we buy from.
 *
 * The alternative was to give those a KIE catalogue row plus a permanently
 * active route pointing away from it. That reads as a routing decision somebody
 * could reverse, and reversing it would send the job to a KIE model id that has
 * never existed. It would also quietly falsify two audits that assume every
 * priced row is KIE's — the margin floor in `check-pricing.ts`, which multiplies
 * by the KIE credit price, and the documented-model check in
 * `crawl-kie-schemas.ts`, which would report each of them as retired.
 */
export function upstreamProvider(variantId: string): string {
  return UPSTREAM[variantId]?.provider ?? HOME_PROVIDER;
}
