"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../src/adapters/http/client";
import { AppLoading } from "../../src/components/AppLoading";
import { OAuthFailureNotice } from "../../src/components/OAuthFailureNotice";
import { SystemState } from "../../src/components/SystemState";
import { CatalogProvider } from "../../src/features/catalog/CatalogProvider";
import { ContentProvider } from "../../src/features/content/ContentProvider";
import { PlansProvider } from "../../src/features/plans/PlansProvider";
import { useCatalog, useContent, usePlans, useSession, useWallet } from "../../src/features/session/useSession";
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
import type { ContentSnapshot } from "../../src/runtime/contracts/content";
import type { Plan } from "../../src/runtime/contracts/plans";

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

  // Neither of these is gated on `authed`: the landing page prices two plans
  // for a visitor who has no session yet, its feature bento renders effects,
  // courses and voices, and the padlocks below need the ladder to name what
  // would unlock a family.
  const plansQuery = usePlans();
  const contentQuery = useContent();

  if (!online) {
    return <SystemState kind="offline" onPrimary={() => window.dispatchEvent(new Event(navigator.onLine ? "online" : "offline"))} />;
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
  if (plansQuery.error) {
    return (
      <SystemState
        kind="service"
        title="پلن‌ها بارگذاری نشدند"
        description="فهرست پلن‌ها و قیمت‌هایشان در دسترس نیست. تا دریافت نسخه معتبر، قیمتی نشان داده نمی‌شود — عدد قدیمی بدتر از نبودن عدد است."
        onPrimary={() => void plansQuery.refetch()}
        requestId={plansQuery.error instanceof ApiError ? plansQuery.error.requestId : undefined}
        busy={plansQuery.isFetching}
      />
    );
  }
  if (contentQuery.error) {
    return (
      <SystemState
        kind="service"
        title="محتوای منتشرشده بارگذاری نشد"
        description="افکت‌ها، دوره‌ها و قفسه ویژه در دسترس نیستند. تا دریافت نسخه معتبر چیزی نشان داده نمی‌شود — نمایش نسخه قدیمی یعنی چیزی که برداشته شده هنوز دیده شود."
        onPrimary={() => void contentQuery.refetch()}
        requestId={contentQuery.error instanceof ApiError ? contentQuery.error.requestId : undefined}
        busy={contentQuery.isFetching}
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
  // The ladder gates the landing page too, not just the app: it prices two plans
  // for a visitor who has no session yet, so there is nothing to paint until it lands.
  if (!plansQuery.data || !contentQuery.data) return <AppLoading />;
  /* A social sign-in that fails lands back here, anonymous, with `?auth=<code>`
     in the URL and no other trace — so the notice belongs on the one branch that
     renders for a signed-out visitor, not inside the landing page's own markup. */
  if (session.status === "anonymous")
    return (
      <ContentProvider content={contentQuery.data}>
        <OAuthFailureNotice />
        <Landing plans={plansQuery.data} onSignIn={authActions.signIn} onSignUp={authActions.signUp} />
      </ContentProvider>
    );
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
      <AuthedTree
        user={session.user}
        wallet={walletQuery.data}
        families={catalogQuery.data.families}
        content={contentQuery.data}
        plans={plansQuery.data}
        authActions={authActions}
      >
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
  content,
  plans,
  authActions,
  children,
}: {
  user: AccountUser;
  wallet: Wallet;
  families: CatalogSnapshot["families"];
  content: ContentSnapshot;
  plans: readonly Plan[];
  authActions: AuthActions;
  children: ReactNode;
}) {
  const { openWallet } = useNavigation();

  return (
    <SessionProvider value={{ user, wallet, ...authActions }}>
      {/* PlansProvider wraps AccessProvider rather than sitting beside it: the
          gate asks the ladder which plan unlocks a family, so the ladder has to
          be above it. */}
      <PlansProvider plans={plans}>
        <AccessProvider planId={null} onUpgrade={openWallet}>
          <CatalogProvider families={families}>
            <ContentProvider content={content}>
              <GenerationsProvider>{children}</GenerationsProvider>
            </ContentProvider>
          </CatalogProvider>
        </AccessProvider>
      </PlansProvider>
    </SessionProvider>
  );
}
