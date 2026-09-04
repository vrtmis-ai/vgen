"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { NavKey } from "../../components/TopBar";
import { navKeyFromPath, navPath } from "../router";

/**
 * The router-shaped helpers App.tsx used to hold.
 *
 * Two of them had no App Router equivalent and are re-implemented rather than
 * ported:
 *
 *  - `location.key === "default"` was how the old code asked "is there anything
 *    to go back to" before calling `navigate(-1)`. App Router exposes no history
 *    key, so in-app navigations are counted here instead: on a deep link or a
 *    fresh tab the count is 1 and back would leave the site entirely, so we
 *    replace with the last workspace path instead.
 *
 *  - `navigate(path, { state: { instant } })` carried a flag that survived only
 *    in memory. Router state does not exist in App Router, so `instant` travels
 *    as a search param and a reloaded result page behaves the same as a fresh one.
 */
interface Navigation {
  tab: NavKey;
  setTab: (key: NavKey) => void;
  goBack: () => void;
  /**
   * `fromGenerationId` carries one of the account's own finished generations in
   * as the new one's opening frame — this is "to video".
   *
   * The generation's id rather than its asset id and URL, because the Generate
   * screen already reads the same list this came from: one short param is
   * enough for it to find both, where a signed URL in the address bar would be
   * several hundred characters that expire.
   */
  openModel: (familyId: string, prompt?: string, fromGenerationId?: string) => void;
  openWallet: () => void;
  openProfile: () => void;
  openResult: (generationId: string, options?: { instant?: boolean; replace?: boolean }) => void;
}

const NavigationContext = createContext<Navigation | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const lastWorkspacePath = useRef(navPath("video"));
  const entryPath = useRef(pathname);
  const hasNavigated = useRef(false);

  useEffect(() => {
    // Compared against the entry path rather than counted. StrictMode invokes
    // effects twice on mount in development, so a counter reads 2 before the
    // user has gone anywhere — and back() on a cold deep link leaves the site.
    // Sticky once set: A → B → A still has history behind it.
    if (pathname !== entryPath.current) hasNavigated.current = true;
    if (navKeyFromPath(pathname)) lastWorkspacePath.current = pathname;
  }, [pathname]);

  const goBack = useCallback(() => {
    if (hasNavigated.current) router.back();
    else router.replace(lastWorkspacePath.current);
  }, [router]);

  const value = useMemo<Navigation>(
    () => ({
      tab: navKeyFromPath(pathname) ?? "video",
      setTab: (key) => router.push(navPath(key)),
      goBack,
      openModel: (familyId, prompt, fromGenerationId) => {
        const query = new URLSearchParams();
        if (prompt) query.set("prompt", prompt);
        if (fromGenerationId) query.set("from", fromGenerationId);
        router.push(`/generate/${encodeURIComponent(familyId)}${query.size ? `?${query.toString()}` : ""}`);
      },
      openWallet: () => router.push("/plans"),
      openProfile: () => router.push("/profile"),
      openResult: (generationId, options) => {
        const path = `/result/${encodeURIComponent(generationId)}${options?.instant ? "?instant=1" : ""}`;
        if (options?.replace) router.replace(path);
        else router.push(path);
      },
    }),
    [goBack, pathname, router],
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation(): Navigation {
  const navigation = useContext(NavigationContext);
  if (!navigation) throw new Error("Navigation is not available. Wrap the screen in NavigationProvider.");
  return navigation;
}
