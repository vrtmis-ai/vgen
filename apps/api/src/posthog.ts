import type { FastifyRequest } from "fastify";
import { PostHog } from "posthog-node";
import { readCookie } from "./auth/cookies";

/**
 * Server-side product events (PostHog, EU cloud), for the actions the browser
 * cannot report reliably: a payment order, an accepted generation job.
 *
 * Two rules, both deliberate:
 *
 * **An event needs the visitor's consent, checked on the request.** The cookie
 * notice promises analytics are off until someone says yes, and the browser
 * half of that is `src/lib/analytics.ts`. This is the other half: the same
 * `vgen_consent` cookie rides on every API request, so a refusal made in the
 * browser also silences the server. Consent is read as "v is current and
 * analytics is true" and anything else, including a version bump the browser
 * moved to first, reads as no — it fails closed, never open.
 *
 * **It never waits.** `capture` queues and a background flush sends, so a login
 * does not sit on a slow or filtered route to PostHog. The queue is drained on
 * shutdown, and events still in it when the process is killed outright are lost,
 * which is the price of not making every response wait for a third party.
 */

const CONSENT_COOKIE = "vgen_consent";
// Mirrors CONSENT_VERSION in src/lib/cookies.ts.
const CONSENT_VERSION = 2;

export function analyticsAllowed(request: FastifyRequest): boolean {
  try {
    const consent = JSON.parse(readCookie(request, CONSENT_COOKIE) ?? "null") as { v?: unknown; analytics?: unknown } | null;
    return consent?.v === CONSENT_VERSION && consent.analytics === true;
  } catch {
    return false;
  }
}

let client: PostHog | null | undefined;

function getClient(): PostHog | null {
  if (client !== undefined) return client;
  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!token || !host) {
    if (process.env.NODE_ENV === "development") {
      console.warn("POSTHOG_PROJECT_TOKEN / POSTHOG_HOST are not set, so no server analytics events are recorded.");
    }
    return (client = null);
  }
  return (client = new PostHog(token, { host }));
}

/** Records `event` for `distinctId` if PostHog is configured and this request's visitor allowed it. */
export function track(request: FastifyRequest, distinctId: string, event: string, properties?: Record<string, unknown>): void {
  if (!analyticsAllowed(request)) return;
  getClient()?.capture({ distinctId, event, ...(properties ? { properties } : {}) });
}

export async function shutdownPostHog(): Promise<void> {
  await client?.shutdown();
}
