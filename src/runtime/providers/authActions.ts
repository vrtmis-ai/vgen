/**
 * Sign-in, sign-up and sign-out, as the session gate and Profile need them.
 *
 * `signOut` is real: it calls the port and clears the cached account, which is
 * everything that step involves.
 *
 * `signIn` and `signUp` now open the screen in app/(auth)/ — the two entry
 * points the landing page offers, kept apart because they open the same screen
 * in different modes and the address bar should say which.
 */
import type { useAuth } from "../../features/session/useAuth";

export const SIGN_IN_PATH = "/signin";
export const SIGN_UP_PATH = "/signup";

export interface AuthActions {
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
}

/**
 * Takes the mutations rather than calling `useAuth()` itself, because it is used
 * from a plain object in the session gate's value and a hook cannot be.
 *
 * `navigate` comes in the same way and for the same reason — the gate holds the
 * router; this stays a plain function so the whole object can be built inline.
 */
export function createAuthActions(auth: ReturnType<typeof useAuth>, navigate: (path: string) => void): AuthActions {
  return {
    signIn: () => navigate(SIGN_IN_PATH),
    signUp: () => navigate(SIGN_UP_PATH),
    signOut: () => auth.logout.mutate(),
  };
}
