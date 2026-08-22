import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "deev_session";
export const OAUTH_STATE_COOKIE = "deev_oauth_state";
/**
 * Staff sessions ride a different cookie from customer ones, so a stolen
 * customer session is never accidentally an admin session and revoking one
 * does not touch the other.
 */
export const ADMIN_COOKIE = "deev_admin";

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

export const readAdminToken = (request: FastifyRequest): string | null => readCookie(request, ADMIN_COOKIE);

export function setAdminCookie(reply: FastifyReply, token: string, expiresAt: Date, options: CookieOptions): void {
  appendCookie(reply, serialize(ADMIN_COOKIE, token, expiresAt, options, "Strict"));
}

export function clearAdminCookie(reply: FastifyReply, options: CookieOptions): void {
  appendCookie(reply, serialize(ADMIN_COOKIE, "", new Date(0), options, "Strict"));
}

export function setOAuthStateCookie(reply: FastifyReply, state: string, options: CookieOptions): void {
  // Ten minutes: long enough to pick a Google account, short enough that an
  // abandoned attempt does not leave a usable token lying around.
  appendCookie(reply, serialize(OAUTH_STATE_COOKIE, state, new Date(Date.now() + 10 * 60_000), options));
}

export function clearOAuthStateCookie(reply: FastifyReply, options: CookieOptions): void {
  appendCookie(reply, serialize(OAUTH_STATE_COOKIE, "", new Date(0), options));
}

/**
 * `Lax` for customers, `Strict` for staff.
 *
 * The customer session has to be Lax and the reason is specific: the Google
 * callback is a cross-site navigation back into the app, and Strict would drop
 * the cookie at exactly the moment it arrives.
 *
 * None of that applies to the staff cookie. Nothing navigates cross-site into
 * /admin — there is no OAuth flow, no email link, no payment return — so Strict
 * costs nothing and removes the whole class of request where another site
 * causes a browser to send a staff session somewhere. That is worth having on
 * the cookie that can re-route production traffic and adjust balances.
 */
type SameSite = "Lax" | "Strict";

function serialize(name: string, value: string, expiresAt: Date, options: CookieOptions, sameSite: SameSite = "Lax"): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
    // HttpOnly: a session token readable from JavaScript is one XSS away from
    // being someone else's account.
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (options.secure) parts.push("Secure");
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join("; ");
}
