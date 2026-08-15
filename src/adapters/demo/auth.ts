import type { AppServices } from "../../runtime/AppServices";
import { ApiError } from "../../runtime/apiError";
import type { AccountUser, Session } from "../../runtime/contracts/session";

/**
 * Auth without a server, so sign-in screens can be built and demonstrated
 * offline.
 *
 * It is a real state machine rather than a set of resolved promises: the demo
 * session starts anonymous, and only the credential calls move it to authed.
 * That is the whole point — a screen that forgets to handle the anonymous case,
 * or that never actually calls the port, looks broken here in the same way it
 * would look broken in production.
 *
 * The failure paths are modelled too, because they are most of the work in an
 * auth screen and the alternative is discovering them against the real API:
 *
 *   - the OTP code is always `123456`; anything else raises `otp_invalid`
 *   - `INVALID` as an invite code raises `invite_invalid`
 *   - an invite code is required, matching early access being on
 *   - `taken@deev.local` raises `account_taken`
 *   - a password under 10 characters raises `invalid_credentials`
 */

/**
 * The same ApiError the HTTP adapter throws — not a lookalike.
 *
 * A screen reads a failure with `error instanceof ApiError` then branches on
 * `.code`. A separate demo error class would make that check pass in production
 * and fail in the mode the screen was actually built in, which is the worst
 * possible place for the two adapters to disagree.
 */
function fail(code: string, message: string, status: number): never {
  throw new ApiError({ code, message, status });
}

export const DEMO_OTP_CODE = "123456";
const MIN_PASSWORD = 10;

const DEMO_USER: AccountUser = {
  id: "demo-user",
  methods: ["email"],
  emailNormalized: "demo@vgen.local",
  displayName: "کاربر نمونه",
  locale: "fa",
};

const ANONYMOUS: Session = { status: "anonymous", host: "web" };

export interface DemoAuthState {
  /** Shared with the demo session service, so signing in changes what it reports. */
  current(): Session;
  set(session: Session): void;
}

export function createDemoAuthState(startAuthed: boolean): DemoAuthState {
  let session: Session = startAuthed ? { status: "authed", host: "web", user: DEMO_USER } : ANONYMOUS;
  return {
    current: () => session,
    set: (next) => {
      session = next;
    },
  };
}

function authedAs(email?: string): Session {
  return {
    status: "authed",
    host: "web",
    user: email ? { ...DEMO_USER, emailNormalized: email } : DEMO_USER,
  };
}

function requireInvite(inviteCode: string | undefined): void {
  // Early access is on in production, so it is on here. A screen that does not
  // collect an invite code should fail in demo mode too.
  if (!inviteCode) {
    fail("invite_required", "DEEV is in early access and needs an invite code", 403);
  }
  if (inviteCode.trim().toUpperCase() === "INVALID") {
    fail("invite_invalid", "That invite code is not valid", 400);
  }
}

export function createDemoAuthService(state: DemoAuthState, now: () => number): AppServices["auth"] {
  return {
    async startPhoneVerification(input) {
      if (!/^[\d+۰-۹\s-]{8,}$/.test(input.phone)) {
        fail("invalid_phone", "That is not an Iranian mobile number", 400);
      }
      return { sent: true, expiresAt: now() + 5 * 60_000 };
    },

    async verifyPhone(input) {
      if (input.code !== DEMO_OTP_CODE) {
        fail("otp_invalid", `In demo mode the code is ${DEMO_OTP_CODE}`, 400);
      }
      requireInvite(input.inviteCode);
      const session = authedAs();
      state.set(session);
      return session;
    },

    async register(input) {
      if (input.email.trim().toLowerCase() === "taken@deev.local") {
        fail("account_taken", "That email already has an account", 409);
      }
      if (input.password.length < MIN_PASSWORD) {
        fail("invalid_credentials", `A password is at least ${MIN_PASSWORD} characters`, 401);
      }
      requireInvite(input.inviteCode);
      const session = authedAs(input.email.trim().toLowerCase());
      state.set(session);
      return session;
    },

    async login(input) {
      if (input.password.length < MIN_PASSWORD) {
        fail("invalid_credentials", "Email or password is wrong", 401);
      }
      const session = authedAs(input.email.trim().toLowerCase());
      state.set(session);
      return session;
    },

    async logout() {
      state.set(ANONYMOUS);
    },
  };
}
