import { useEffect } from "react";

/**
 * Edge-swipe "back" gesture, RTL/LTR aware (mirrors iOS):
 *   LTR — start near the LEFT edge, swipe right.
 *   RTL — start near the RIGHT edge, swipe left.
 * Passive touch listeners only: no re-renders, no scroll blocking, GPU-free.
 * Pass `undefined` to disable (e.g. on root screens).
 */
export function useSwipeBack(onBack: (() => void) | undefined) {
  useEffect(() => {
    if (!onBack) return;
    const EDGE = 32; // px from the screen edge where the gesture may start
    const DIST = 70; // horizontal travel required to trigger
    const SLOPE = 0.6; // max vertical drift relative to horizontal travel
    const WINDOW_MS = 700; // must complete within this time

    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let armed = false;
    let rtl = true;

    const start = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      // read per-gesture so a live language/direction switch mirrors instantly
      rtl = document.documentElement.dir !== "ltr";
      const w = window.innerWidth;
      armed = rtl ? t.clientX > w - EDGE : t.clientX < EDGE;
      x0 = t.clientX;
      y0 = t.clientY;
      t0 = Date.now();
    };
    const move = (e: TouchEvent) => {
      if (!armed) return;
      const t = e.touches[0];
      if (!t) return;
      const dx = rtl ? x0 - t.clientX : t.clientX - x0;
      const dy = Math.abs(t.clientY - y0);
      if (dx > DIST && dy < dx * SLOPE && Date.now() - t0 < WINDOW_MS) {
        armed = false;
        onBack();
      }
    };
    const end = () => {
      armed = false;
    };

    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    return () => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", end);
    };
  }, [onBack]);
}
