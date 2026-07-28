/**
 * Who the current user is, without the rest of the app knowing where they came
 * from.
 *
 * Telegram is the only host today, but a website and a native app are planned,
 * and a user may eventually reach the same account through more than one of
 * them. Screens therefore read this, never `window.Telegram` — adding a sign-in
 * method should mean adding a branch here and nothing else.
 *
 * ⚠️ Everything below is UNTRUSTED. Telegram's `initDataUnsafe` is named that
 * way for a reason: the client can put anything in it. It is fine for painting a
 * name and avatar, and must never decide what someone owns or may spend. Once
 * the backend exists it validates the signed `initData` and returns the real
 * identity, and `useSession` starts reading that instead.
 */

export type AuthProvider = "telegram" | "web" | "none";

export interface Session {
  provider: AuthProvider;
  /** Provider-scoped id — NOT our user id. Pairs with provider to identify. */
  externalId?: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
  /** Language the host reports, for defaulting the UI. */
  locale?: string;
}

interface TelegramUser {
  id?: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  language_code?: string;
}

function telegramSession(): Session | null {
  const wa = (window as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: TelegramUser } } } }).Telegram?.WebApp;
  const u = wa?.initDataUnsafe?.user;
  if (!u) return null;
  return {
    provider: "telegram",
    externalId: u.id != null ? String(u.id) : undefined,
    displayName: [u.first_name, u.last_name].filter(Boolean).join(" ") || undefined,
    username: u.username,
    avatarUrl: u.photo_url,
    locale: u.language_code,
  };
}

/**
 * The signed blob a backend needs to prove who this is. Only Telegram has one;
 * other hosts will authenticate their own way. Never send the unsigned fields
 * above to the server as identity — send this.
 */
export function telegramInitData(): string | null {
  const wa = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  return wa?.initData || null;
}

/** Current session. Falls back to an anonymous one outside a known host. */
export function getSession(): Session {
  return telegramSession() ?? { provider: "none" };
}

export function useSession(): Session {
  // No subscription yet: the host hands its user over before React mounts and
  // it cannot change mid-session. When sign-in becomes asynchronous — a web
  // login, or a JWT fetched from our own backend — this becomes real state.
  return getSession();
}
