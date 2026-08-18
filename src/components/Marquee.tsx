"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * A row that travels, seamlessly, without measuring anything.
 *
 * The usual implementation reads the content's width with a ResizeObserver and
 * animates a pixel offset. This renders the row twice and animates the track by
 * `-50%` of its own width — which is exactly one copy, whatever that copy
 * happens to measure. No observer, no layout read, no re-animation when a font
 * loads and the row reflows, and nothing to go wrong on the first paint before a
 * measurement exists.
 *
 * The echo is `aria-hidden`. A screen reader on the naive version reads the
 * whole list twice, which is the tell that the duplicate is a rendering trick
 * rather than content.
 *
 * It pauses on hover and on focus-within: the row carries names people are meant
 * to read, and a name that slides away as you look at it is decoration. Focus
 * matters as much as hover — anything tabbable inside must be able to sit still
 * while it is being used.
 *
 * Motion is CSS rather than a spring, so `prefers-reduced-motion` can stop it in
 * the stylesheet with no JavaScript involved. Stopped, the row becomes
 * scrollable instead of a truncated fragment — the same rule the loading states
 * in components.css follow: a reduced-motion fallback still has to show the
 * thing.
 */
export function Marquee({
  children,
  seconds = 40,
  reverse = false,
  className,
  label,
}: {
  children: ReactNode;
  /** One full pass. Longer is slower; the row's width does not change it. */
  seconds?: number;
  /**
   * Travel the other way.
   *
   * `animation-direction` rather than a second pair of keyframes, so it composes
   * with the RTL swap instead of fighting it: whichever keyframe the document's
   * direction selected simply plays backwards. Two stacked rows want this — in
   * lockstep they read as one tall band with a gap in it.
   */
  reverse?: boolean;
  className?: string;
  /** Names the row for a screen reader, which sees one copy rather than two. */
  label?: string;
}) {
  return (
    <div
      className={`vg-marquee ${reverse ? "vg-marquee--reverse" : ""} ${className ?? ""}`}
      style={{ "--vg-marquee-duration": `${seconds}s` } as CSSProperties}
      {...(label ? { role: "group", "aria-label": label } : {})}
    >
      <div className="vg-marquee__track">
        <div className="vg-marquee__run">{children}</div>
        <div className="vg-marquee__run vg-marquee__run--echo" aria-hidden>
          {children}
        </div>
      </div>
    </div>
  );
}
