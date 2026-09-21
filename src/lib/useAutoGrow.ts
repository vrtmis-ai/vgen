import { useLayoutEffect, useState, type RefObject } from "react";

/**
 * A prompt box that grows with what is written in it.
 *
 * Every dock's prompt was a fixed `rows` — two in the image dock — with
 * `resize-none` and a hidden scrollbar. Past that line count the text simply
 * left: no scrollbar to say so, no handle to pull, and nothing on screen to
 * suggest the sentence continued. A prompt is the one field on these surfaces
 * that is read back and edited, and it was the one that could not be read.
 *
 * Measured rather than counted, because a line is not a line: `\n` is not the
 * only way text wraps, and the box's width changes with the dock. Setting the
 * height to `auto` first is what makes `scrollHeight` report the *content*
 * rather than the height already set — without it the box only ever grows.
 *
 * `useLayoutEffect` so the size lands in the same frame as the character. In an
 * effect the box visibly jumps one paint after the keystroke that caused it.
 */
/** Returns the height the content wants, which is how a caller knows the box
 *  is holding more than it can show. Reported as state rather than read off
 *  the ref during render: a ref read is a frame behind and never re-renders
 *  the thing that depends on it. */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxHeight: number): number {
  const [content, setContent] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // `auto` first, or `scrollHeight` reports the height already set and the
    // box can only ever grow.
    element.style.height = "auto";
    const wanted = element.scrollHeight;
    element.style.height = `${Math.min(wanted, maxHeight)}px`;
    // Past the cap the box stops growing and the text scrolls inside it.
    element.style.overflowY = wanted > maxHeight ? "auto" : "hidden";
    setContent(wanted);
  }, [ref, value, maxHeight]);
  return content;
}

/**
 * How tall a prompt box may get, collapsed and expanded.
 *
 * Five lines at `leading-6` plus the inset padding: enough to read a real
 * prompt without the box becoming the page. Expanded is half the window, which
 * is the most it can take and still leave the work it describes visible —
 * which is the whole reason the control collapses again.
 */
export const PROMPT_LINES = 5;
export const promptCap = (expanded: boolean, lineHeight = 24): number =>
  expanded ? Math.max(240, Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.5)) : PROMPT_LINES * lineHeight + 12;
