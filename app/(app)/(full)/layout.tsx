"use client";

import type { ReactNode } from "react";
import { Shell } from "../../../src/components/Shell";
import { useSwipeBack } from "../../../src/lib/useSwipeBack";
import { useNavigation } from "../../../src/runtime/providers/NavigationProvider";

/**
 * Full-screen flows: no top bar, and swipe-back is live.
 *
 * App.tsx decided this with a `fullScreenRoute` boolean that listed four
 * pathname prefixes by hand. It was really a layout distinction all along, so
 * the route group carries it and the list is gone.
 */
export default function FullScreenLayout({ children }: { children: ReactNode }) {
  const { goBack } = useNavigation();
  useSwipeBack(goBack);
  return <Shell>{children}</Shell>;
}
