/**
 * Sign-in, sign-up and sign-out.
 *
 * These are still no-ops, but not for the reason they originally were. The API
 * side is done: `POST /api/v1/auth/otp/start` and `/otp/verify`, `/register`,
 * `/login`, `/logout` and the Google pair all exist and are tested. What is
 * missing is the port between them and the UI — there is no `auth` member on
 * `AppServices`, so there is no seam a screen could call through and no demo
 * implementation to develop against.
 *
 * Wiring that port is backend-side work. Until it lands, a login screen has
 * nothing to submit to; see docs/API.md for the routes and their shapes.
 *
 * In demo mode the session adapter reports an authenticated user, so none of
 * these are reachable through the UI: the landing page that calls signIn/signUp
 * only renders for an anonymous session.
 */
const NOT_YET = "DEEV auth exists on the API but has no AppServices port yet. See docs/API.md.";

function unavailable(action: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[auth] ${action}: ${NOT_YET}`);
}

export const authActions = {
  signIn: () => unavailable("signIn"),
  signUp: () => unavailable("signUp"),
  signOut: () => unavailable("signOut"),
};
