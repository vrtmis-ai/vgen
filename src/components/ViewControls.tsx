import { useEffect, useState } from "react";
import { SquaresFour, Rows, Minus, Plus } from "@phosphor-icons/react";

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
    setMode: (mode: ViewMode) => setState((s) => ({ ...s, mode })),
    setDensity: (density: Density) => setState((s) => ({ ...s, density: Math.max(0, Math.min(DENSITY_STEPS.length - 1, density)) })),
  };
}

export function ViewControls({
  mode,
  density,
  onMode,
  onDensity,
}: {
  mode: ViewMode;
  density: Density;
  onMode: (m: ViewMode) => void;
  onDensity: (d: Density) => void;
}) {
  const last = DENSITY_STEPS.length - 1;
  return (
    <div className="flex items-center gap-1.5">
      {/* Density. Stepper rather than a range input: there are five stops, and
          a slider implies a continuum that the grid cannot render. Hidden below
          `sm`, where the column count is driven by width, not preference. */}
      <div
        className="hidden items-center gap-0.5 rounded-lg p-0.5 sm:flex"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
        role="group"
        aria-label="اندازهٔ کارت‌ها"
      >
        {/* Fewer columns = bigger cards, so "+" has to mean bigger. Wiring the
            plus to a higher column count would invert what the icon promises. */}
        <button
          onClick={() => onDensity(density - 1)}
          disabled={density === 0}
          aria-label="کارت‌های بزرگ‌تر"
          className="grid size-7 place-items-center rounded-md disabled:opacity-30"
          style={{ color: "var(--vg-text-muted)" }}
        >
          <Plus size={13} weight="bold" />
        </button>
        <button
          onClick={() => onDensity(density + 1)}
          disabled={density === last}
          aria-label="کارت‌های کوچک‌تر"
          className="grid size-7 place-items-center rounded-md disabled:opacity-30"
          style={{ color: "var(--vg-text-muted)" }}
        >
          <Minus size={13} weight="bold" />
        </button>
      </div>

      <div
        className="flex items-center gap-0.5 rounded-lg p-0.5"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
        role="group"
        aria-label="نحوهٔ نمایش"
      >
        {([
          { m: "grid" as const, Icon: SquaresFour, label: "نمای شبکه‌ای" },
          { m: "list" as const, Icon: Rows, label: "نمای فهرستی" },
        ]).map(({ m, Icon, label }) => (
          <button
            key={m}
            onClick={() => onMode(m)}
            aria-label={label}
            title={label}
            aria-pressed={mode === m}
            className="grid size-7 place-items-center rounded-md transition-colors"
            style={{
              background: mode === m ? "var(--vg-surface-overlay)" : "transparent",
              color: mode === m ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
            }}
          >
            <Icon size={14} weight={mode === m ? "fill" : "regular"} />
          </button>
        ))}
      </div>
    </div>
  );
}
