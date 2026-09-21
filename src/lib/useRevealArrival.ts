import { useCallback, useEffect, useRef } from "react";

/** Long enough for uploads and a quote to come back, short enough to be "this press". */
const ARMED_FOR_MS = 60_000;

/**
 * Scroll a new generation into view, once, because somebody pressed for it.
 *
 * The studios no longer send the browser to کارهای من when a job is accepted.
 * The job lands first on the canvas it was started from, and "first" can be
 * off screen: on a phone the canvas sits under the form, and on any width a
 * long history can have scrolled its head away.
 *
 * `arm()` at the press, then give `target` to the element for `newest`. The
 * next change of `newest` scrolls that element into view. A change nobody
 * armed for — the history arriving, a job from another tab — moves nothing,
 * because a page that scrolls by itself is worse than the problem this fixes.
 * The arming expires, so a refused press cannot fire on some later arrival.
 */
export function useRevealArrival(newest: string | undefined): {
  arm: () => void;
  target: (element: HTMLElement | null) => void;
} {
  const armedAt = useRef<number | null>(null);
  const last = useRef(newest);
  const element = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (newest === last.current) return;
    last.current = newest;
    const armed = armedAt.current !== null && Date.now() - armedAt.current < ARMED_FOR_MS;
    if (!armed || !newest) return;
    armedAt.current = null;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // Optional call: jsdom has no scrollIntoView, and a test should not need one.
    element.current?.scrollIntoView?.({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [newest]);

  const arm = useCallback(() => {
    armedAt.current = Date.now();
  }, []);
  const target = useCallback((node: HTMLElement | null) => {
    element.current = node;
  }, []);
  return { arm, target };
}
