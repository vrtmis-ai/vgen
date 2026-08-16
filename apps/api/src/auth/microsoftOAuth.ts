import { OidcClient, readDisplayName, requireSubject, type OidcProfile } from "./oidc";

/**
 * Which Microsoft audience may sign in.
 *
 * `common` is both work/school and personal accounts, `organizations` is
 * work/school only, `consumers` is personal Microsoft accounts only. A tenant
 * GUID or verified domain restricts sign-in to one organisation, which is
 * enterprise SSO rather than a consumer login — it changes how much the `email`
 * claim can be trusted, so it is not a cosmetic setting. See `emailIsVerified`.
 */
export type MicrosoftTenant = "common" | "organizations" | "consumers" | (string & {});

export interface MicrosoftOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Defaults to `common`. */
  tenant?: MicrosoftTenant | undefined;
  fetchImpl?: typeof fetch | undefined;
}

const MULTI_TENANT = new Set(["common", "organizations", "consumers"]);

/**
 * Microsoft sign-in, authorization-code flow against the v2.0 endpoints.
 *
 * Same sanctions caveat as Google: login.microsoftonline.com is not dependably
 * reachable from Iran, so this is an additional door rather than the main one.
 * Phone OTP remains the route that works without a VPN.
 */
export class MicrosoftOAuth extends OidcClient {
  constructor(config: MicrosoftOAuthConfig) {
    const tenant = config.tenant?.trim() || "common";
    super({
      authEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`,
      tokenEndpoint: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      scope: "openid email profile",
      readProfile: (claims) => readMicrosoftProfile(claims, tenant),
      fetchImpl: config.fetchImpl,
    });
  }
}

/**
 * Whether Microsoft has actually proved this address belongs to this person.
 *
 * This matters more here than it does for Google, and gets its own function
 * because getting it wrong is an account takeover rather than a papercut.
 * `signInWithOAuth` links a new identity onto an existing user when the email
 * matches, so an address we believe on insufficient evidence is a way into
 * somebody else's DEEV account and their credit balance.
 *
 * Microsoft, unlike Google, has no `email_verified` claim. What it has instead:
 *
 *   - `xms_edov` — "email domain owner verified". The explicit answer, and
 *     authoritative in both directions. It is an *optional* claim, so it is
 *     only present when the app registration asks for it; configure it, because
 *     it is the only signal that holds for a single-tenant registration.
 *   - For **multi-tenant** apps, Microsoft removed unverified addresses from the
 *     token entirely in June 2023: an `email` that is present at all has a
 *     verified domain owner, is a Microsoft or Google account, or came through
 *     the one-time-passcode flow. So presence is proof — but only there.
 *
 * Pinned to one organisation, neither guarantee applies on its own, so an
 * address is believed only on an explicit `xms_edov`. The cost of being wrong
 * in that direction is a duplicate account, which is recoverable; the cost of
 * being wrong in the other direction is not.
 */
export function emailIsVerified(claims: Record<string, unknown>, tenant: string): boolean {
  const edov = claims.xms_edov;
  // Microsoft has shipped this as both a JSON boolean and a string.
  if (edov === true || edov === "true" || edov === "1") return true;
  if (edov === false || edov === "false" || edov === "0") return false;
  return MULTI_TENANT.has(tenant);
}

export function readMicrosoftProfile(claims: Record<string, unknown>, tenant: string): OidcProfile {
  // Only the `email` claim, never `preferred_username`. The latter is mutable,
  // is not guaranteed to be an address at all, and Microsoft documents it as
  // unsuitable for identification — which is exactly what linking by it does.
  const claimed = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : null;
  const emailVerified = claimed !== null && emailIsVerified(claims, tenant);

  return {
    subject: requireSubject(claims),
    email: emailVerified ? claimed : null,
    emailVerified,
    displayName: readDisplayName(claims),
  };
}
