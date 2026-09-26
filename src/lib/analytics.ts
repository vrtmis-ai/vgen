import posthog from "posthog-js";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, allows, parseConsent, serializeConsent, type Consent } from "./cookies";

/**
 * Product analytics (PostHog, EU cloud), behind the visitor's consent.
 *
 * **PostHog is not initialised at all until `vgen_consent` says analytics.**
 * Opting out of capture is not enough: an initialised SDK still fetches its
 * remote config and posts a feature-flags request carrying an anonymous id and
 * device details, none of which the visitor agreed to. So before a yes there is
 * no init, no request to PostHog and nothing stored; `apply` is the only thing
 * that starts it. Events go to our own `/ingest` (a rewrite in next.config.ts),
 * not to posthog.com: that host is slow and often filtered from Iran, and ad
 * blockers drop it.
 *
 * Client-only, and every export is a no-op until PostHog has started — so a
 * checkout without a token, or a visitor who has not agreed, is safe at every
 * call site.
 */

const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const CONSENT_EVENT = "vgen:consent";

let started = false;
let userId: string | null = null;

function readConsent(): Consent | null {
  const entry = document.cookie.split("; ").find((part) => part.startsWith(`${CONSENT_COOKIE}=`));
  return parseConsent(entry?.slice(CONSENT_COOKIE.length + 1));
}

function init(projectToken: string): void {
  posthog.init(projectToken, {
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    defaults: "2026-01-30",
    // localStorage only, no cookie: nothing here needs a cross-subdomain id, and
    // a cookie set on a parent domain is one we could not reliably delete again.
    persistence: "localStorage",
    capture_exceptions: true,
    // Nothing here uses feature flags or surveys, and each is a request (flags
    // carries an anonymous id and device details) that is not worth making.
    advanced_disable_flags: true,
    disable_surveys: true,
    // Replay records the screen, and this product's screen is people's prompts
    // and generations. Off until that has been decided on purpose, and the
    // cookie notice does not claim it.
    disable_session_recording: true,
    debug: process.env.NODE_ENV === "development",
  });
  started = true;
}

/**
 * Withdrawal has to actually remove what was stored, not just stop adding to it:
 * the ids PostHog kept are exactly what the visitor just took back. Its own
 * `__ph_opt_in_out_` record of the refusal stays (it is what keeps capture off
 * for the rest of this page) and is listed in the cookie policy.
 */
function forget(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(`ph_${token}`)) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable (private windows); then there is nothing to remove.
  }
}

/** Match PostHog to a choice. */
function apply(analytics: boolean): void {
  if (analytics) {
    if (!token) return;
    if (!started) init(token);
    // After an earlier withdrawal the SDK remembers "no" across page loads.
    if (!posthog.has_opted_in_capturing()) posthog.opt_in_capturing();
    if (userId) posthog.identify(userId);
    return;
  }
  // Only when it was on: opting out of something never opted into would write
  // a "no" record to storage for every visitor who simply declined.
  if (started && posthog.has_opted_in_capturing()) {
    posthog.opt_out_capturing();
    forget();
  }
}

export function startAnalytics(): void {
  if (started) return;
  if (!token) {
    if (process.env.NODE_ENV === "development") {
      console.warn("NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is not set, so no analytics events are recorded.");
    }
    return;
  }
  apply(allows(readConsent(), "analytics"));
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (started) posthog.capture(event, properties);
}

export function captureError(error: unknown): void {
  if (started) posthog.captureException(error);
}

/**
 * Who is signed in, by id only — never the email or handle, which would send
 * personal data to a third party for no analytical gain. `null` is logout.
 */
export function identifyUser(id: string | null): void {
  const previous = userId;
  userId = id;
  if (!started) return;
  if (id) {
    if (posthog.has_opted_in_capturing()) posthog.identify(id);
    return;
  }
  // Nobody was signed in, so there is nothing to forget: reset() would only mint
  // a fresh anonymous id for a visitor who is still the same visitor.
  if (previous === null) return;
  // reset() also clears the SDK's consent record, back to its default of "on":
  // re-apply the visitor's actual choice, or logging out would quietly turn
  // capture back on for someone who had withdrawn.
  posthog.reset();
  apply(allows(readConsent(), "analytics"));
}

/** Record a choice, apply it now, and tell whatever else is showing the old one. */
export function saveConsent(analytics: boolean): void {
  const value = serializeConsent(analytics);
  // Lax, not Strict: a visitor arriving from a link should not be asked again
  // because their answer was withheld on a cross-site navigation.
  document.cookie = `${CONSENT_COOKIE}=${value};path=/;max-age=${CONSENT_MAX_AGE_SECONDS};samesite=lax`;
  apply(analytics);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: parseConsent(value) }));
}

export function onConsentChange(listener: (consent: Consent | null) => void): () => void {
  const handler = (event: Event) => listener((event as CustomEvent<Consent | null>).detail);
  window.addEventListener(CONSENT_EVENT, handler);
  return () => window.removeEventListener(CONSENT_EVENT, handler);
}
