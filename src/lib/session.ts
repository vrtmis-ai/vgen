/**
 * Who the current user is, and separately, where the app is running.
 *
 * Those are two axes, and the previous version of this file collapsed them into
 * one. It read identity out of Telegram's `initDataUnsafe`, which made Telegram
 * *the* sign-in method. The locked product decision is the opposite: sign-in is
 * Google or a phone number, and **Telegram is a container, like a browser** —
 * the app will also run on the web and later as a native app, and the same
 * person must reach the same account and the same wallet through any of them.
 *
 * So:
 *   host    — which shell the app is painted inside. Never an identity.
 *   methods — how the person proved who they are. Can be more than one.
 *   status  — whether we know yet. `loading` is not decoration: the moment
 *             sign-in involves a network round trip, there is a frame where the
 *             answer is genuinely unknown, and a screen that renders "signed
 *             out" during it will flash the landing page at a signed-in user.
 *
 * ⚠️ Nothing here is trusted. `telegramInitData` is a *signed* blob and it is
 * carried so the backend can validate it with HMAC and link an account to a
 * Telegram user — it is never, on its own, proof of identity for spending. The
 * unsigned `initDataUnsafe` fields this file used to read are gone entirely.
 */

/** Whether we know who this is yet. */
export type AuthStatus = "loading" | "anonymous" | "authed";

/** How the person proved who they are. Both can be attached to one account. */
export type IdentityMethod = "google" | "phone";

/** Which shell the app is painted inside. Never an identity. */
export type Host = "telegram" | "web" | "native";

export interface AccountUser {
  /** OUR user id, issued by the backend. Not a provider's id. */
  id: string;
  methods: IdentityMethod[];
  /**
   * Uniqueness keys, and deliberately not the raw email address.
   * `user@gmail.com`, `u.ser@gmail.com` and `user+1@gmail.com` are one inbox and
   * three strings, so uniqueness on the raw string is free to bypass. Google's
   * `sub` and an E.164-normalised phone are the stable ones; the normalised
   * email is a second guard, never the first.
   */
  googleSub?: string | undefined;
  phoneE164?: string | undefined;
  emailNormalized?: string | undefined;

  displayName?: string | undefined;
  avatarUrl?: string | undefined;
  locale?: string | undefined;

  /**
   * Admin-flagged Vgen team account: plans price at cost rather than at margin.
   * The flag lives on the account, so pricing has to read it — see
   * `effectiveUsd` in data/plans.ts.
   */
  isTeam?: boolean | undefined;
}

export interface Session {
  status: AuthStatus;
  host: Host;
  /**
   * Telegram's signed payload, when we are running inside Telegram. A host hint
   * for the backend to verify and link against — NOT a credential the client
   * may act on. Absent everywhere else.
   */
  telegramInitData?: string | undefined;
  /** Present only when `status === "authed"`. */
  user?: AccountUser | undefined;
}

interface TelegramWebApp {
  initData?: string;
}

function telegramWebApp(): TelegramWebApp | undefined {
  return (window as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
}

/** Which shell we are painted inside. Adding a host means adding a branch here. */
export function detectHost(): Host {
  return telegramWebApp() ? "telegram" : "web";
}

/**
 * The signed blob the backend needs to link this account to a Telegram user.
 * Only Telegram has one; other hosts authenticate their own way.
 */
export function telegramInitData(): string | null {
  return telegramWebApp()?.initData || null;
}

/**
 * Placeholder for the real sign-in flow.
 *
 * There is no `/auth` endpoint yet, so this stands in for one. Flip it to false
 * to see what a signed-out visitor gets — which today is the bare shell in
 * App.tsx, and will be the landing page once that is designed.
 */
const DEMO_SIGNED_IN = true;

const DEMO_USER: AccountUser = {
  id: "demo-user",
  methods: ["google"],
  googleSub: "demo-google-sub",
  displayName: "کاربر نمونه",
  locale: "fa",
};

/**
 * Current session.
 *
 * Still synchronous, because nothing it reads is async yet. When `/auth`
 * exists this becomes real React state: `loading` while the token is exchanged,
 * then `authed` or `anonymous`. Screens already branch on `status`, so that
 * change lands here and nowhere else.
 */
export function getSession(): Session {
  const host = detectHost();
  const initData = telegramInitData();
  return {
    status: DEMO_SIGNED_IN ? "authed" : "anonymous",
    host,
    ...(initData ? { telegramInitData: initData } : {}),
    ...(DEMO_SIGNED_IN ? { user: DEMO_USER } : {}),
  };
}

export function useSession(): Session {
  return getSession();
}
