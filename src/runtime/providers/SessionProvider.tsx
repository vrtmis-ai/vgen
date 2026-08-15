"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AccountUser } from "../contracts/session";
import type { Wallet } from "../contracts/wallet";

/**
 * The signed-in user and their wallet, for screens that used to receive both as
 * props threaded down from App.tsx.
 *
 * Only rendered below the session gate, so both values are non-null by
 * construction — the gate does not render its children until it has them.
 */
interface AuthedSession {
  user: AccountUser;
  wallet: Wallet;
  signIn: () => void;
  signUp: () => void;
  signOut: () => void;
}

const SessionContext = createContext<AuthedSession | null>(null);

export function SessionProvider({ value, children }: { value: AuthedSession; children: ReactNode }) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useAuthedSession(): AuthedSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("No authenticated session. This screen renders below the session gate.");
  return session;
}
