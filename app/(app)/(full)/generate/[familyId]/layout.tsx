"use client";

import type { ReactNode } from "react";
import { AppTopBar } from "../../../../../src/components/AppTopBar";

/**
 * The generate screen keeps the nav bar.
 *
 * It sits in the full-screen group for the swipe-back its siblings need, and
 * that group deliberately drops the bar. Here it is the wrong trade: this is
 * where a visitor lands from a model card and then spends real time, and the
 * only ways out were the browser's back button and a gesture that does not
 * exist on a desktop. Everything else the group gives it — swipe-back, no page
 * fade — still applies.
 *
 * Nothing is highlighted: generate is not one of the nav destinations, and the
 * tab fallback would point at the video studio whatever model is open.
 */
export default function GenerateLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppTopBar active={null} />
      {children}
    </>
  );
}
