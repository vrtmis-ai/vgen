// Shared motion tokens — every animation communicates state, not decoration.
import type { Transition, Variants } from "framer-motion";

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const spring: Transition = { type: "spring", stiffness: 420, damping: 34, mass: 0.9 };
export const easeOut = (duration = 0.4): Transition => ({ duration, ease: EASE_OUT });

/** Staggered rise for lists/grids. */
export const riseParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};
export const riseItem: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE_OUT } },
};

/** Screen/tab crossfade. */
export const pageFade = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: EASE_OUT },
};
