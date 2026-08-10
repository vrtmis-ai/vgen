import { useCallback, useEffect, useRef, useState } from "react";

/* ---------------------------------------------------------------------------
   "There is more over there."

   A scrolling strip with its scrollbar hidden is invisible content. The pricing
   comparison shipped that way — a quarter of the plans off the edge of a box
   painted to look complete — and the nav row does the same on a phone, where
   three of seven destinations sit past the fold with nothing to say so.

   Hiding the bar is often right: a scrollbar inside a 44px chrome element reads
   as a rendering fault, and under a table it competes with the data. What is
   not right is hiding it and offering nothing in its place. This returns the
   two facts a caller needs to fade the correct edge, and only that edge.

   `scrollLeft` is signed under RTL — it counts down from zero toward negative as
   you move away from the start — so the distance travelled is `abs(scrollLeft)`
   and the distance remaining is `max - abs(scrollLeft)`. Subtracting from
   `scrollWidth` the way an LTR-only implementation would leaves the fade stuck
   on permanently at one end and never appearing at the other.
   --------------------------------------------------------------------------- */

export interface EdgeFade<T extends HTMLElement> {
  /** Attach to the scrolling element. */
  ref: React.RefObject<T>;
  /** Attach to the same element's `onScroll`. */
  onScroll: () => void;
  /** Content is hidden past the start edge (the user has scrolled away from it). */
  atStart: boolean;
  /** Content is hidden past the end edge — the common case worth fading. */
  more: boolean;
}

/** Generic in the element so a `<nav>` and a `<div>` can both use it without
 *  either side casting — the ref has to match the tag it lands on. */
export function useEdgeFade<T extends HTMLElement = HTMLDivElement>(): EdgeFade<T> {
  const ref = useRef<T>(null);
  const [state, setState] = useState({ atStart: false, more: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const travelled = Math.abs(el.scrollLeft);
    // 1px of slack: fractional layout leaves sub-pixel remainders at both ends,
    // which would otherwise keep a fade up over a strip that is fully scrolled.
    const next = { atStart: max > 1 && travelled > 1, more: max > 1 && travelled < max - 1 };
    setState((s) => (s.atStart === next.atStart && s.more === next.more ? s : next));
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    // Resize matters as much as scroll: the overflow can appear or vanish from
    // a viewport change alone, with the scroll position never moving.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Children changing — a filter narrowing a chip row, a plan column being
    // added — changes scrollWidth without resizing the box.
    const mo = new MutationObserver(measure);
    mo.observe(el, { childList: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [measure]);

  return { ref, onScroll: measure, atStart: state.atStart, more: state.more };
}
