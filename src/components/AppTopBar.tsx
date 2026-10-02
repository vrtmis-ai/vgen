"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TopBar, type NavKey } from "./TopBar";
import { useNavMenus } from "./navMenu";
import { navPaths } from "../runtime/router";
import { useNavigation } from "../runtime/providers/NavigationProvider";
import { useGenerations } from "../runtime/providers/GenerationsProvider";
import { useSession } from "../runtime/providers/SessionProvider";
import { useI18n } from "../lib/i18n";
import { grantedTotal } from "../lib/credits";

/**
 * Fetch every tab's route before anyone clicks one.
 *
 * The bar navigates with `router.push` from a `<button>`, so none of this
 * happens on its own: `<Link>` is what Next prefetches, and there is no Link
 * here. Measured on a throttled connection, a cold tab click spent 595ms
 * fetching the route payload and 1.2s before the URL changed. Prefetched, that
 * work is already done and the switch is immediate.
 *
 * On idle so it never competes with the screen the visitor is actually on, and
 * once per mount — the router caches, so repeat calls are free. With a
 * `loading.tsx` beside each route this fetches the fallback rather than the
 * whole page, which is the cheap half and the half that makes the click feel
 * instant.
 */
function usePrefetchTabs(): void {
  const router = useRouter();
  useEffect(() => {
    const run = () => {
      for (const path of navPaths()) router.prefetch(path);
    };
    if (typeof window.requestIdleCallback !== "function") {
      const timer = window.setTimeout(run, 400);
      return () => window.clearTimeout(timer);
    }
    const handle = window.requestIdleCallback(run, { timeout: 2_000 });
    return () => window.cancelIdleCallback(handle);
  }, [router]);
}

/**
 * The top bar with the app's state already wired into it.
 *
 * `TopBar` itself stays a pure component a test can render without standing up
 * a catalogue, a session and a wallet; this is the part that reaches for all
 * three. It lives here rather than in the nav layout because two layouts need
 * it now — the tab'd area, and the generate screen, which is full-bleed and
 * still has to be escapable.
 *
 * `active` is nullable for exactly that second case: the generate screen is
 * not one of the nav destinations, and highlighting whichever one the fallback
 * picked would point at a studio the visitor is not in.
 */
export function AppTopBar({ active }: { active: NavKey | null }) {
  const { setTab, goHome, openWallet, openProfile, openModel } = useNavigation();
  const { user, wallet, signIn, signOut } = useSession();
  const { gens } = useGenerations();
  const { lang, setLang, t } = useI18n();
  const menus = useNavMenus();
  usePrefetchTabs();

  return (
    <TopBar
      active={active}
      onNav={setTab}
      onHome={goHome}
      menus={menus}
      onOpenModel={openModel}
      coins={wallet?.spendable ?? null}
      account={{
        name: user?.displayName || t("p_guest"),
        ...(user?.emailNormalized ? { email: user.emailNormalized } : {}),
        coins: wallet?.spendable ?? 0,
        coinsGranted: wallet ? grantedTotal(wallet) : 0,
        // Null, not a guess: `GET /plans` cannot yet say which plan an account
        // is on, and the plans screen refuses to fake one for the same reason.
        planLabel: null,
        galleryCount: gens.length,
        onGallery: () => setTab("gallery"),
        onToggleLang: () => setLang(lang === "fa" ? "en" : "fa"),
        onSignOut: signOut,
      }}
      onWallet={openWallet}
      onProfile={openProfile}
      onSignIn={signIn}
    />
  );
}
