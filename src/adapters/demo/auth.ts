import type { AppServices } from "../../runtime/AppServices";
import { ApiError } from "../../runtime/apiError";
import { readContact } from "../../lib/contact";
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
  handle: "demo",
  displayName: "کاربر نمونه",
  locale: "fa",
};

/**
 * Demo mode offers both providers, because demo mode is a server with
 * everything configured. Its sign-in screen has to be able to show the shape a
 * fully-configured deployment has.
 */
const DEMO_AUTH_PROVIDERS = ["google", "microsoft"] as const;

const ANONYMOUS: Session = { status: "anonymous", host: "web", authProviders: [...DEMO_AUTH_PROVIDERS], phoneSignIn: true };

export interface DemoAuthState {
  /** Shared with the demo session service, so signing in changes what it reports. */
  current(): Session;
  set(session: Session): void;
}

export function createDemoAuthState(startAuthed: boolean): DemoAuthState {
  let session: Session = startAuthed
    ? { status: "authed", host: "web", user: DEMO_USER, authProviders: [...DEMO_AUTH_PROVIDERS], phoneSignIn: true }
    : ANONYMOUS;
  return {
    current: () => session,
    set: (next) => {
      session = next;
    },
  };
}

function authedAs(email?: string, handle?: string): Session {
  return {
    status: "authed",
    host: "web",
    user: { ...DEMO_USER, ...(email ? { emailNormalized: email } : {}), ...(handle ? { handle } : {}) },
    authProviders: [...DEMO_AUTH_PROVIDERS],
    phoneSignIn: true,
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
      if (input.handle.trim().toLowerCase() === "taken") {
        fail("handle_taken", "That username is taken", 409);
      }
      requireInvite(input.inviteCode);
      const session = authedAs(input.email.trim().toLowerCase(), input.handle.trim().toLowerCase());
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

    /* Remembers nothing: the list lives on a server this mode does not have.
       It refuses what `readContact` refuses, so the form's own check and the
       one behind it agree — a demo that accepts anything teaches the shape of
       a screen that does not exist. */
    async joinWaitlist(contact) {
      if (!readContact(contact)) {
        throw new ApiError({ code: "validation_failed", message: "That is not an address or a mobile number.", status: 400 });
      }
    },

    /* A number to draw the strip with. Nobody has signed up in demo mode and
       nothing here is stored, so this is the shape of the answer rather than
       an answer. */
    async waitlistCount() {
      return 0;
    },

    async checkInvite(code) {
      // The same rule `requireInvite` applies, so demo mode refuses the code
      // at the door that it would refuse at signup.
      return code.trim().length >= 3 && code.trim().toUpperCase() !== "INVALID";
    },

    async startProviderSignIn(provider) {
      /* Signs you in rather than navigating.
         In production this hands the browser to Google or Microsoft and the page
         is gone; there is nothing to hand it to here. Resolving without changing
         the session would be worse than either: the button would look wired,
         nothing would happen, and the screen would have no way to tell that from
         a provider that is merely slow.

         No invite gate on this path, matching the server — `signInWithOAuth`
         links onto an existing user or creates one, and early access is enforced
         at the routes that take a credential. */
      state.set(authedAs(`demo-${provider}@deev.local`));
    },

    async logout() {
      state.set(ANONYMOUS);
    },

    async updateProfile(edit) {
      const session = state.current();
      if (session.status !== "authed") {
        fail("unauthorised", "Sign in first", 401);
      }
      if (edit.handle?.trim().toLowerCase() === "taken") {
        fail("handle_taken", "That username is taken", 409);
      }
      const user = {
        ...session.user,
        ...(edit.handle ? { handle: edit.handle.trim().toLowerCase() } : {}),
        ...(edit.displayName ? { displayName: edit.displayName.trim() } : {}),
      };
      state.set({ ...session, user });
      return user;
    },
  };
}
