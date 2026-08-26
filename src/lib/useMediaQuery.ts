"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A media query as React state.
 *
 * `useSyncExternalStore` rather than `useState` + an effect, because the effect
 * version renders once with the wrong answer and then corrects itself — which
 * on the nav is a visible flicker between two different bars.
 *
 * The server snapshot is always `false`. There is no viewport during a render
 * on the server, and guessing "probably desktop" would mean the markup React
 * hydrates disagrees with the markup it produced. False is the honest answer
 * and, for every current caller, the one that degrades: the narrow layout works
 * on a wide screen, and the client corrects it on the first commit.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
