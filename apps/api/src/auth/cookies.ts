import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "deev_session";
export const OAUTH_STATE_COOKIE = "deev_oauth_state";

/**
 * Cookie handling, by hand rather than through a plugin.
 *
 * Two cookies, neither of which needs signing. The session value is an opaque
 * 256-bit token that is worthless without the matching row and is checked
 * against a stored hash on every request; the OAuth state is compared against
 * itself. Signing protects values that are guessable or meaningful, and these
 * are neither.
 */
export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    const value = decodeURIComponent(part.slice(separator + 1).trim());
    return value === "" ? null : value;
  }
  return null;
}

export const readSessionToken = (request: FastifyRequest): string | null => readCookie(request, SESSION_COOKIE);

export interface CookieOptions {
  /** False only for local http development; the cookie is Secure everywhere else. */
  secure: boolean;
  /** Set to share a session across api.deev.ir and deev.ir. */
  domain?: string | undefined;
}

/**
 * Appends rather than replaces. `reply.header` overwrites, and a login that
 * both clears the OAuth state and sets the session writes two — the second
 * silently discarding the first.
 */
function appendCookie(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader("set-cookie");
  if (existing === undefined) reply.header("set-cookie", cookie);
  else reply.header("set-cookie", [...(Array.isArray(existing) ? existing : [String(existing)]), cookie]);
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, options: CookieOptions): void {
  appendCookie(reply, serialize(SESSION_COOKIE, token, expiresAt, options));
}

export function clearSessionCookie(reply: FastifyReply, options: CookieOptions): void {
  appendCookie(reply, serialize(SESSION_COOKIE, "", new Date(0), options));
}

export function setOAuthStateCookie(reply: FastifyReply, state: string, options: CookieOptions): void {
  // Ten minutes: long enough to pick a Google account, short enough that an
  // abandoned attempt does not leave a usable token lying around.
  appendCookie(reply, serialize(OAUTH_STATE_COOKIE, state, new Date(Date.now() + 10 * 60_000), options));
}

export function clearOAuthStateCookie(reply: FastifyReply, options: CookieOptions): void {
  appendCookie(reply, serialize(OAUTH_STATE_COOKIE, "", new Date(0), options));
}

function serialize(name: string, value: string, expiresAt: Date, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
    // HttpOnly: a session token readable from JavaScript is one XSS away from
    // being someone else's account.
    "HttpOnly",
    // Lax, not Strict: the Google callback is a cross-site navigation back into
    // the app, and Strict would drop the cookie exactly on arrival.
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join("; ");
}
