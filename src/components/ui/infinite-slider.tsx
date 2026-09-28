"use client";
import { cn } from "@/lib/utils";
import { useMotionValue, animate, motion } from "framer-motion";
import { Children, useState, useEffect } from "react";

type InfiniteSliderProps = {
  children: React.ReactNode;
  gap?: number;
  duration?: number;
  durationOnHover?: number;
  direction?: "horizontal" | "vertical";
  reverse?: boolean;
  className?: string;
};

export function InfiniteSlider({
  children,
  gap = 16,
  duration = 25,
  durationOnHover,
  direction = "horizontal",
  reverse = false,
  className,
}: InfiniteSliderProps) {
  const [currentDuration, setCurrentDuration] = useState(duration);
  const translation = useMotionValue("0%");

  /* Percent of the track's own width, not a measured pixel distance.
     ────────────────────────────────────────────────────────────────
     The original computed the loop distance from `useMeasure` and listed
     `width` in this effect's dependencies. The arithmetic was right — for our
     row, `(7831 + 112) / 2` is exactly one copy plus one gap — but the approach
     is fragile in a way that shows: any change in measured width re-runs the
     effect, and `animate()` restarts from the beginning. A late-loading font, an
     image settling, a resize, and the row visibly jumps. Because the measurement
     kept changing, it also never completed a pass, so it never looked like a
     loop.

     The track holds the row twice, so moving it by 50% of its own width is
     exactly one copy — whatever that copy measures, whenever it changes. Nothing
     to observe, nothing to re-run, and no restart to see.

     `reverse` flips the direction. It is what RTL needs: a flex row lays its
     first child at the *right* edge there, so the track hangs off to the left
     and travelling further left walks away from the only content there is. */
  useEffect(() => {
    const controls = animate(translation, ["0%", reverse ? "50%" : "-50%"], {
      ease: "linear",
      duration: currentDuration,
      repeat: Infinity,
      repeatType: "loop",
      repeatDelay: 0,
    });
    return controls.stop;
  }, [translation, currentDuration, reverse]);

  /* Hover changes the speed and nothing else. The original swapped the infinite
     animation for a one-shot tween to the end of the track and restarted the
     loop on completion; if that tween finished, the row stopped. Changing
     `currentDuration` re-runs the effect above, which is a plain restart of a
     looping animation — slower, still looping. */
  const hoverProps = durationOnHover
    ? {
        onHoverStart: () => setCurrentDuration(durationOnHover),
        onHoverEnd: () => setCurrentDuration(duration),
      }
    : {};

  /* The gap rides on each item, not on the flex container, and that is what
     makes the seam invisible.

     `gap` puts space BETWEEN children, so a track of `{children}{children}`
     holding N items twice measures `2N·item + (2N-1)·gap` — one gap short of
     two whole copies, because the row ends on an item rather than on a space.
     Moving it by 50% of that is `N·item + (N-0.5)·gap`, which is half a gap
     less than one copy. At 112px that is 56px the row never travelled, and it
     made them up in a single frame every time the loop restarted: one visible
     jump per pass, always at the same place in the list.

     Trailing margin on every item instead, so each one measures `item + gap`
     and two copies are exactly twice one copy. 50% is then one copy exactly,
     whatever the items measure and whenever a late font or logo changes them. */
  const items = Children.toArray(children);
  const edge = direction === "horizontal" ? "marginInlineEnd" : "marginBlockEnd";

  return (
    <div className={cn("overflow-hidden", className)}>
      <motion.div
        className="flex w-max"
        style={{
          ...(direction === "horizontal" ? { x: translation } : { y: translation }),
          flexDirection: direction === "horizontal" ? "row" : "column",
        }}
        {...hoverProps}
      >
        {[...items, ...items].map((child, index) => (
          // Index, because the list is rendered twice on purpose and a child's
          // own key would collide with its echo.
          <div key={index} style={{ [edge]: gap, flex: "none" }}>
            {child}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
