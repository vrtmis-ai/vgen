import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The half of an OpenID Connect authorization-code flow that is the same for
 * every provider.
 *
 * Google and Microsoft differ in three places and three only: which endpoints
 * they publish, which scopes they want, and how much their `email` claim can be
 * believed. Everything else — the CSRF state, the back-channel code exchange,
 * pulling claims out of the id_token — is the protocol, not the vendor, so it
 * lives here once.
 *
 * The `id_token` is deliberately NOT verified against the provider's signing
 * keys. It does not need to be: it arrives on the back channel, in the response
 * to a request authenticated with the client secret, straight from the token
 * endpoint over TLS. Signature verification is what protects an id_token that
 * arrived by some other route — the implicit flow, or a client handing one to a
 * server. Adding JWKS fetching here would buy nothing and add a network
 * dependency to every sign-in.
 */

export class OAuthError extends Error {
  readonly code = "oauth_failed";
  constructor(message: string) {
    super(message);
    this.name = "OAuthError";
  }
}

/** What a provider tells us about the person who just signed in. */
export interface OidcProfile {
  subject: string;
  /**
   * Null unless the provider proved the address belongs to this person.
   *
   * Null is not a degraded value to be papered over — it is the difference
   * between linking to an existing DEEV account and creating a new one. See
   * `signInWithOAuth`: an address that arrives here is enough to take over the
   * account that already owns it.
   */
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

/** Everything a provider has to state to be usable. */
export interface OidcClientConfig {
  authEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  /** Provider-specific: which claims carry the address, and whether to trust them. */
  readProfile(claims: Record<string, unknown>): OidcProfile;
  fetchImpl?: typeof fetch | undefined;
}

export class OidcClient {
  constructor(protected readonly config: OidcClientConfig) {}

  /**
   * `state` is a CSRF token, not a container. It is returned to the caller so
   * it can be stashed in a short-lived cookie and compared on the way back —
   * without it, an attacker can complete a login into their own account in
   * someone else's browser.
   */
  createAuthorizationUrl(): { url: string; state: string } {
    const state = randomBytes(16).toString("base64url");
    const url = new URL(this.config.authEndpoint);
    url.searchParams.set("client_id", this.config.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.config.scope);
    url.searchParams.set("state", state);
    // Ask for an account chooser rather than silently reusing whichever account
    // the browser is already signed into.
    url.searchParams.set("prompt", "select_account");
    return { url: url.toString(), state };
  }

  async exchangeCode(code: string): Promise<OidcProfile> {
    const send = this.config.fetchImpl ?? fetch;
    const response = await send(this.config.tokenEndpoint, {
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
    if (!response.ok) throw new OAuthError(`The provider rejected the code exchange with ${response.status}`);

    const payload = (await response.json()) as { id_token?: string };
    if (!payload.id_token) throw new OAuthError("The provider returned no id_token");
    return this.config.readProfile(decodeIdTokenClaims(payload.id_token));
  }
}

/** Constant-time state comparison, so the check cannot be probed byte by byte. */
export function statesMatch(returned: string | undefined, expected: string | undefined): boolean {
  if (!returned || !expected) return false;
  const a = createHash("sha256").update(returned).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The payload segment, decoded. Reading claims is not the same as trusting them. */
export function decodeIdTokenClaims(idToken: string): Record<string, unknown> {
  const segments = idToken.split(".");
  if (segments.length !== 3) throw new OAuthError("Malformed id_token");
  try {
    return JSON.parse(Buffer.from(segments[1]!, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    throw new OAuthError("Unreadable id_token payload");
  }
}

/** Every provider has one, and an id_token without it identifies nobody. */
export function requireSubject(claims: Record<string, unknown>): string {
  const subject = typeof claims.sub === "string" ? claims.sub : null;
  if (!subject) throw new OAuthError("id_token has no subject");
  return subject;
}

export function readDisplayName(claims: Record<string, unknown>): string | null {
  return typeof claims.name === "string" ? claims.name : null;
}
