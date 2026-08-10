import { useEffect, useState } from "react";
import { SquaresFour, Rows } from "@phosphor-icons/react";

/* ---------------------------------------------------------------------------
   How the output canvas is laid out: grid or list, and how big.

   The reference puts both in the top corner of every canvas — a density slider
   and a pair of view-mode icons — and it is not decoration. A wall of 3:4
   thumbnails is the right shape for picking a frame out of forty; a list is the
   right shape for reading which prompt produced what. Neither is correct all
   the time, so the user picks.

   The choice persists. Someone who works in list view does not want to reset it
   on every visit, and re-choosing a layout every session is the kind of small
   tax that makes a tool feel like it is not paying attention.
   --------------------------------------------------------------------------- */

export type ViewMode = "grid" | "list";

/** Columns at each density step, from loosest to tightest, at the widest
 *  breakpoint. Narrower viewports scale these down in the consuming grid. */
export const DENSITY_STEPS = [3, 4, 5, 6, 7] as const;
export type Density = number; // index into DENSITY_STEPS

/** Target row height for a justified layout, per density step. Taken from the
 *  reference, whose rows measured between roughly 185px and 481px. */
export const ROW_HEIGHTS = [460, 360, 290, 230, 185] as const;

const KEY = "vgen-view";

export function useViewMode(scope: string, initial: { mode?: ViewMode; density?: Density } = {}) {
  const storeKey = `${KEY}:${scope}`;
  const [state, setState] = useState<{ mode: ViewMode; density: Density }>(() => {
    // localStorage throws in private mode on some browsers; a layout preference
    // is never worth taking the screen down for.
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) {
        const p = JSON.parse(raw) as { mode: ViewMode; density: Density };
        if ((p.mode === "grid" || p.mode === "list") && p.density >= 0 && p.density < DENSITY_STEPS.length) return p;
      }
    } catch {
      /* fall through to the default */
    }
    return { mode: initial.mode ?? "grid", density: initial.density ?? 2 };
  });

  useEffect(() => {
    try {
      localStorage.setItem(storeKey, JSON.stringify(state));
    } catch {
      /* not worth surfacing */
    }
  }, [storeKey, state]);

  return {
    mode: state.mode,
    density: state.density,
    cols: DENSITY_STEPS[state.density]!,
    rowHeight: ROW_HEIGHTS[state.density]!,
    setMode: (mode: ViewMode) => setState((s) => ({ ...s, mode })),
    setDensity: (density: Density) => setState((s) => ({ ...s, density: Math.max(0, Math.min(DENSITY_STEPS.length - 1, density)) })),
  };
}

export function ViewControls({
  mode,
  density,
  onMode,
  onDensity,
  modes = true,
}: {
  mode: ViewMode;
  density: Density;
  onMode: (m: ViewMode) => void;
  onDensity: (d: Density) => void;
  /**
   * Whether this canvas offers a list at all.
   *
   * The image wall does not. It is a wall of frames — the whole surface exists
   * so you can scan pictures, and a list of them is just the wall with the
   * pictures made small and a prompt bolted on. Only the size control belongs
   * there. Video and the gallery do offer it: they hold few enough items that
   * reading which prompt produced what is a real way to look at them.
   */
  modes?: boolean;
}) {
  const last = DENSITY_STEPS.length - 1;
  return (
    <div className="flex items-center gap-1.5">
      {/* Density is a slider, as theirs is — a 12px thumb on a thin track, not
          the stepper this used to be. Five stops still, but dragging one
          control beats hunting two buttons when you are eyeballing a wall.
          Hidden below `sm`, where width decides the count, not preference.

          Bookended by a small and a large square so the direction reads without
          a label: left is bigger, right is more. Under RTL the browser mirrors
          the input and the icons mirror with it, so the pairing holds. */}
      {/* `@xl`, a container query, not `sm`. This control lives in a canvas
          that may sit beside a 342px panel, so the viewport being 800px wide
          says nothing about whether the header has room — at that width the
          audio canvas is 443px and the density group plus the mode toggle plus
          the tabs came to more than it could hold. Consumers mark their canvas
          `@container`; where none does, the query falls back to the nearest
          one, which is the page. */}
      <div className="hidden items-center gap-2 @xl:flex" role="group" aria-label="اندازهٔ کارت‌ها">
        <span className="block rounded-[2px]" style={{ width: 11, height: 11, background: "var(--vg-text-muted)" }} aria-hidden />
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          // Inverted: index 0 is the loosest grid (biggest cards), so the thumb
          // travelling right must raise the column count.
          value={density}
          onChange={(e) => onDensity(Number(e.target.value))}
          aria-label="اندازهٔ کارت‌ها"
          aria-valuetext={`${DENSITY_STEPS[density]} ستون`}
          className="vg-density w-[92px]"
        />
        <span className="block rounded-[1px]" style={{ width: 6, height: 6, background: "var(--vg-text-muted)" }} aria-hidden />
      </div>

      {modes && (
        <div
          className="flex items-center gap-0.5 rounded-lg p-0.5"
          style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
          role="group"
          aria-label="نحوهٔ نمایش"
        >
          {/* Labelled, as theirs are — 61x32 "List" and 66x32 "Grid" at radius
              8. Two abstract icons side by side make the user guess which is
              which; the word costs 30px and removes the guess. */}
          {([
            { m: "list" as const, Icon: Rows, label: "فهرست" },
            { m: "grid" as const, Icon: SquaresFour, label: "شبکه" },
          ]).map(({ m, Icon, label }) => (
            <button
              key={m}
              onClick={() => onMode(m)}
              aria-pressed={mode === m}
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-semibold transition-colors"
              style={{
                background: mode === m ? "var(--vg-surface-overlay)" : "transparent",
                color: mode === m ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
              }}
            >
              <Icon size={13} weight={mode === m ? "fill" : "regular"} />
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
