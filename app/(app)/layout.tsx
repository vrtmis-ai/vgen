"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../src/adapters/http/client";
import { AppLoading } from "../../src/components/AppLoading";
import { SystemState } from "../../src/components/SystemState";
import { CatalogProvider } from "../../src/features/catalog/CatalogProvider";
import { useCatalog, useSession, useWallet } from "../../src/features/session/useSession";
import { AccessProvider } from "../../src/lib/access";
import { useOnlineStatus } from "../../src/lib/useOnlineStatus";
import Landing from "../../src/screens/Landing";
import { useAuth } from "../../src/features/session/useAuth";
import { createAuthActions, type AuthActions } from "../../src/runtime/providers/authActions";
import { GenerationsProvider } from "../../src/runtime/providers/GenerationsProvider";
import { NavigationProvider, useNavigation } from "../../src/runtime/providers/NavigationProvider";
import { SessionProvider } from "../../src/runtime/providers/SessionProvider";
import type { AccountUser } from "../../src/runtime/contracts/session";
import type { Wallet } from "../../src/runtime/contracts/wallet";
import type { CatalogSnapshot } from "../../src/runtime/contracts/catalog";

/**
 * The session gate — the seven early returns App.tsx opened with.
 *
 * Three states, not two. `loading` is a real frame the moment sign-in involves
 * a network round trip, and painting "signed out" during it flashes a landing
 * page at someone who is in fact signed in. The app had no concept of any of
 * this: it rendered Home unconditionally and handed every screen a constant
 * balance, so a visitor with no identity got the full product.
 *
 * Returning early here means the nested (nav) and (full) layouts never mount,
 * which is what keeps the landing page out of the app shell: it is the one
 * surface that is desktop-first and full-width, so it must not inherit the
 * phone-shaped cap.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const router = useRouter();
  const auth = useAuth();
  const authActions = createAuthActions(auth, (path) => router.push(path));
  const sessionQuery = useSession();
  const session = sessionQuery.data ?? { status: "loading" as const, host: "web" as const };
  const authed = session.status === "authed";
  const walletQuery = useWallet(authed);
  const catalogQuery = useCatalog(authed);

  if (!online) {
    return (
      <SystemState kind="offline" onPrimary={() => window.dispatchEvent(new Event(navigator.onLine ? "online" : "offline"))} />
    );
  }
  if (sessionQuery.error) {
    return (
      <SystemState
        kind="service"
        onPrimary={() => void sessionQuery.refetch()}
        requestId={sessionQuery.error instanceof ApiError ? sessionQuery.error.requestId : undefined}
        busy={sessionQuery.isFetching}
      />
    );
  }
  if (walletQuery.error) {
    return (
      <SystemState
        kind="service"
        title="کیف پول بارگذاری نشد"
        description="موجودی و اعتبارها دریافت نشدند. برای جلوگیری از نمایش عدد اشتباه، فضای ساخت تا دریافت دوباره کیف پول متوقف شده است."
        onPrimary={() => void walletQuery.refetch()}
        requestId={walletQuery.error instanceof ApiError ? walletQuery.error.requestId : undefined}
        busy={walletQuery.isFetching}
      />
    );
  }
  if (catalogQuery.error) {
    return (
      <SystemState
        kind="service"
        title="کاتالوگ مدل‌ها بارگذاری نشد"
        description="فهرست مدل‌ها و قیمت‌های منتشرشده در دسترس نیست. تا دریافت نسخه معتبر، امکان ساخت غیرفعال می‌ماند."
        onPrimary={() => void catalogQuery.refetch()}
        requestId={catalogQuery.error instanceof ApiError ? catalogQuery.error.requestId : undefined}
        busy={catalogQuery.isFetching}
      />
    );
  }
  if (session.status === "loading") return <AppLoading label="در حال بررسی نشست کاربری…" />;
  if (session.status === "anonymous") return <Landing onSignIn={authActions.signIn} onSignUp={authActions.signUp} />;
  if (!walletQuery.data || !catalogQuery.data) return <AppLoading />;

  /* Everything below is signed in, so it all sits inside AccessProvider.
     The tier gate is asked five levels down — a picker row, a dock chip, a
     create button — and threading a plan id through Studio, FormPanel and every
     dock to reach them would put a billing parameter on components with no
     other interest in billing. See lib/access.

     `planId` is null because the backend cannot answer it yet, and null reads
     as tier 1, which is what a signup gift should buy. The day /me returns a
     plan, this one line is the only thing that changes. */
  return (
    <NavigationProvider>
      <AuthedTree user={session.user} wallet={walletQuery.data} families={catalogQuery.data.families} authActions={authActions}>
        {children}
      </AuthedTree>
    </NavigationProvider>
  );
}

/** Split out so it can call useNavigation(), which needs NavigationProvider above it. */
function AuthedTree({
  user,
  wallet,
  families,
  authActions,
  children,
}: {
  user: AccountUser;
  wallet: Wallet;
  families: CatalogSnapshot["families"];
  authActions: AuthActions;
  children: ReactNode;
}) {
  const { openWallet } = useNavigation();

  return (
    <SessionProvider value={{ user, wallet, ...authActions }}>
      <AccessProvider planId={null} onUpgrade={openWallet}>
        <CatalogProvider families={families}>
          <GenerationsProvider>{children}</GenerationsProvider>
        </CatalogProvider>
      </AccessProvider>
    </SessionProvider>
  );
}
