"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountUser } from "../contracts/session";
import type { Wallet } from "../contracts/wallet";

/**
 * Who is looking at the app, which is now two answers rather than one.
 *
 * A visitor with no session can reach every screen except the ones that are
 * about them personally — they can open the studios, read the academy, browse
 * the catalogue and the community. What they cannot do is spend, so `user` and
 * `wallet` are null and the buttons that would have started a generation say
 * "sign in" instead.
 *
 * Modelled as null rather than as a fabricated guest account on purpose. A
 * placeholder wallet would render a balance nobody holds, and every screen that
 * prints one would have to know which figures were real.
 */
export interface Session {
  /** Null for a visitor who has not signed in. */
  user: AccountUser | null;
  /** Null for a visitor. There is no wallet until there is an account. */
  wallet: Wallet | null;
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
}

/** A session that is definitely signed in — what `useAuthedSession` returns. */
export interface AuthedSession extends Session {
  user: AccountUser;
  wallet: Wallet;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ value, children }: { value: Session; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The session, whoever it belongs to. `user === null` means a visitor.
 *
 * Most screens want this one: they render the same thing either way and only
 * differ at the point of spending.
 */
export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("No session in context. This screen renders below the session gate.");
  return session;
}

/** True when there is nobody signed in — the one branch most screens need. */
export function useIsVisitor(): boolean {
  return useSession().user === null;
}

/**
 * For a screen that cannot render at all without an account — Profile is the
 * only one. Everything else should use `useSession` and degrade instead, so a
 * visitor sees the product rather than a wall.
 */
export function useAuthedSession(): AuthedSession {
  const session = useSession();
  if (!session.user || !session.wallet) {
    throw new Error("This screen requires a signed-in account. Gate it, or use useSession() and handle the visitor.");
  }
  return session as AuthedSession;
}
