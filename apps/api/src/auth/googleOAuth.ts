import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
}

export interface GoogleProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

export class OAuthError extends Error {
  readonly code = "oauth_failed";
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
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
 * The `id_token` is not verified against Google's signing keys here, and does
 * not need to be: it arrives on the back channel, in the response to a request
 * authenticated with the client secret, straight from Google's token endpoint.
 * Signature verification is what protects an id_token that arrived by some
 * other route — the implicit flow, or a client handing one to a server.
 */
export class GoogleOAuth {
  constructor(private readonly config: GoogleOAuthConfig) {}

  /**
   * `state` is a CSRF token, not a container. It is returned to the caller so
   * it can be stashed in a short-lived cookie and compared on the way back —
   * without it, an attacker can complete a login into their own account in
   * someone else's browser.
   */
  createAuthorizationUrl(): { url: string; state: string } {
    const state = randomBytes(16).toString("base64url");
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", state);
    // Ask for an account chooser rather than silently reusing whichever Google
    // account the browser is already signed into.
    url.searchParams.set("prompt", "select_account");
    return { url: url.toString(), state };
  }

  async exchangeCode(code: string): Promise<GoogleProfile> {
    const send = this.config.fetchImpl ?? fetch;
    const response = await send(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new OAuthError(`Google rejected the code exchange with ${response.status}`);

    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token) throw new OAuthError("Google returned no id_token");
    return decodeIdToken(payload.id_token);
  }
}

/** Constant-time state comparison, so the check cannot be probed byte by byte. */
export function statesMatch(returned: string | undefined, expected: string | undefined): boolean {
  if (!returned || !expected) return false;
  const a = createHash("sha256").update(returned).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function decodeIdToken(idToken: string): GoogleProfile {
  const segments = idToken.split(".");
  if (segments.length !== 3) throw new OAuthError("Malformed id_token");
  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new OAuthError("Unreadable id_token payload");
  }

  const subject = typeof claims.sub === "string" ? claims.sub : null;
  if (!subject) throw new OAuthError("id_token has no subject");

  // An unverified address must not be treated as proof of anything: accepting
  // it would let anyone claim an account by signing up to Google with someone
  // else's address and never confirming it.
  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  const email = emailVerified && typeof claims.email === "string" ? claims.email.toLowerCase() : null;

  return {
    subject,
    email,
    emailVerified,
    displayName: typeof claims.name === "string" ? claims.name : null,
  };
}
