/**
 * Sign-in, sign-up and sign-out, as the session gate and Profile need them.
 *
 * `signOut` is real: it calls the port and clears the cached account, which is
 * everything that step involves.
 *
 * `signIn` and `signUp` are still navigation stubs, and deliberately so. The
 * API and the port behind them are done — see `useAuth()` — but the screen they
 * should open does not exist yet, and it belongs to whoever owns the UI. Wiring
 * these to a route that 404s would be worse than warning.
 *
 * To build that screen: run with NEXT_PUBLIC_DEMO_ANONYMOUS=1 so the app starts
 * signed out, call `useAuth()` from the screen, and point these two at it.
 */
import type { useAuth } from "../../features/session/useAuth";

const NOT_YET = "No sign-in screen yet. The port is ready — see useAuth() and docs/API.md.";

function unavailable(action: string): void {
  if (process.env.NODE_ENV !== "production") console.warn(`[auth] ${action}: ${NOT_YET}`);
}

export interface AuthActions {
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
}

/**
 * Takes the mutations rather than calling `useAuth()` itself, because it is used
 * from a plain object in the session gate's value and a hook cannot be.
 */
export function createAuthActions(auth: ReturnType<typeof useAuth>): AuthActions {
  return {
    signIn: () => unavailable("signIn"),
    signUp: () => unavailable("signUp"),
    signOut: () => auth.logout.mutate(),
  };
}
