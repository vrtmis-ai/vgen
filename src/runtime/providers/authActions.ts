/**
 * Sign-in, sign-up and sign-out.
 *
 * Clerk was removed with the Next.js migration and DEEV's own auth — phone OTP,
 * email + password, Google OAuth on the deev-db `users` / `auth_identities` /
 * `sessions` tables — lands in a later phase. Until then these are deliberate
 * no-ops rather than links to routes that do not exist yet.
 *
 * In demo mode the session adapter reports an authenticated user, so none of
 * these are reachable through the UI: the landing page that calls signIn/signUp
 * only renders for an anonymous session.
 */
const NOT_YET = "DEEV auth is not wired yet. Sign-in arrives with the own-auth phase.";

function unavailable(action: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[auth] ${action}: ${NOT_YET}`);
}

export const authActions = {
  signIn: () => unavailable("signIn"),
  signUp: () => unavailable("signUp"),
  signOut: () => unavailable("signOut"),
};
