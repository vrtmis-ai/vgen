import type { AppServices } from "../../runtime/AppServices";
import type { DemoAuthState } from "./auth";

/**
 * Reads whatever the demo auth state currently holds, so signing in and out
 * actually move the app between the landing page and the workspace.
 *
 * It stays authed by default. Demo mode's job is that the whole product is
 * reachable with no backend, and starting anonymous would put a sign-in screen
 * that does not exist yet between a developer and every other screen. Set
 * NEXT_PUBLIC_DEMO_ANONYMOUS=1 to start signed out and work on auth itself.
 */
export function createDemoSessionService(state: DemoAuthState): AppServices["session"] {
  return {
    async getCurrent() {
      return state.current();
    },
  };
}
