"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { Shell } from "../../../src/components/Shell";
import { TopBar } from "../../../src/components/TopBar";
import { useNavMenus } from "../../../src/components/navMenu";
import { pageFade } from "../../../src/lib/motion";
import { useNavigation } from "../../../src/runtime/providers/NavigationProvider";
import { useSession } from "../../../src/runtime/providers/SessionProvider";

/**
 * The nav'd area.
 *
 * No sidebar and no bottom tab bar: one 44px row carries every destination, and
 * the same row serves phone and desktop. See components/TopBar.
 *
 * No AnimatePresence and no exit animation on the tab area. `mode="wait"` holds
 * the outgoing screen mounted until its exit animation reports completion, and
 * that report rides on requestAnimationFrame — which the browser throttles to
 * nothing in a backgrounded or non-compositing tab. The next screen then never
 * mounts and the app looks frozen on the old one. A keyed enter-only fade gives
 * the same read with nothing to wait on.
 */
export default function NavLayout({ children }: { children: ReactNode }) {
  const { tab, setTab, openWallet, openProfile, openModel } = useNavigation();
  const { wallet, signIn } = useSession();
  // Built here rather than inside TopBar: the bar stays a pure component that a
  // test can render without standing up a catalogue.
  const menus = useNavMenus();

  return (
    <Shell>
      <TopBar
        active={tab}
        onNav={setTab}
        menus={menus}
        onOpenModel={openModel}
        coins={wallet?.spendable ?? null}
        onWallet={openWallet}
        onProfile={openProfile}
        onSignIn={signIn}
      />
      <div key={tab}>
        <motion.div initial={pageFade.initial} animate={pageFade.animate} transition={pageFade.transition}>
          {children}
        </motion.div>
      </div>
    </Shell>
  );
}
