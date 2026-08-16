import { OidcClient, readDisplayName, requireSubject, type OidcProfile } from "./oidc";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch | undefined;
}

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Google sign-in, authorization-code flow.
 *
 * Worth knowing before relying on this: Google is not reliably reachable from
 * Iran, so for most of the intended audience this path needs a VPN and phone
 * OTP is the one that actually works. It is here because it was asked for, not
 * because it is the primary route in.
 *
 * The protocol machinery lives in OidcClient. What is Google-specific is below:
 * two endpoints and one rule about when an address may be believed.
 */
export class GoogleOAuth extends OidcClient {
  constructor(config: GoogleOAuthConfig) {
    super({
      authEndpoint: AUTH_ENDPOINT,
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      scope: "openid email profile",
      readProfile: readGoogleProfile,
      fetchImpl: config.fetchImpl,
    });
  }
}

export function readGoogleProfile(claims: Record<string, unknown>): OidcProfile {
  // An unverified address must not be treated as proof of anything: accepting
  // it would let anyone claim an account by signing up to Google with someone
  // else's address and never confirming it.
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  const email = emailVerified && typeof claims.email === "string" ? claims.email.toLowerCase() : null;

  return { subject: requireSubject(claims), email, emailVerified, displayName: readDisplayName(claims) };
}

export { OAuthError, statesMatch, type OidcProfile as GoogleProfile } from "./oidc";
