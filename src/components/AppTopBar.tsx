"use client";

import { TopBar, type NavKey } from "./TopBar";
import { useNavMenus } from "./navMenu";
import { useNavigation } from "../runtime/providers/NavigationProvider";
import { useGenerations } from "../runtime/providers/GenerationsProvider";
import { useSession } from "../runtime/providers/SessionProvider";
import { useI18n } from "../lib/i18n";
import { grantedTotal } from "../lib/credits";

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
