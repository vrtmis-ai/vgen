import type { ReactNode } from "react";

/* ---------------------------------------------------------------------------
   The instrument surface.

   The dock used to be a stack of borderless washes separated by 8px of gap.
   Nothing in it was subordinate to anything else, so the eye had no entry
   point — measured on the video dock that is a cover, three upload boxes, a
   prompt, a pill, a row, a slider and two selects, all at the same weight.

   These four pieces are the workflow-studio prototype's node anatomy, on this
   product's tokens: one surface with a hairline *ring* (a box-shadow, so it
   costs no layout box), a head that names the thing, and blocks divided by
   hairlines rather than by air. The prototype's numbers, kept: radius 11, head
   52px, a 24px icon tile at radius 7, 12.5px semibold over 10.5px, chips 10.5px
   at radius 5.
   --------------------------------------------------------------------------- */
export const PANEL_RING = "0 0 0 1px var(--vg-border), 0 18px 40px -22px rgb(0 0 0 / 0.92)";

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[11px]" style={{ background: "var(--vg-surface)", boxShadow: PANEL_RING }}>
      {children}
    </div>
  );
}

/** A block inside a Panel. Every one carries its own leading rule, so the head
 *  needs no trailing one and two blocks never stack two hairlines. */
export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={className} style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
      {children}
    </div>
  );
}

/**
 * The head: a tinted icon tile, the subject, and what will run it underneath.
 *
 * The gradient is a top light rather than a fill — it ends at transparent, so
 * the head reads as the lit face of the surface instead of a second colour.
 */
export function PanelHead({ icon, title, sub, action }: { icon: ReactNode; title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div
      className="flex h-[52px] items-center gap-2 px-2.5"
      style={{ background: "linear-gradient(180deg, rgb(255 255 255 / 0.035), rgb(255 255 255 / 0))" }}
    >
      <span
        className="grid size-6 shrink-0 place-items-center rounded-[7px]"
        style={{ background: "var(--vg-primary-a14)", color: "var(--vg-primary-soft)" }}
      >
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-px leading-[1.25]">
        <b className="truncate text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
          {title}
        </b>
        {sub ? (
          <span className="truncate text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
            {sub}
          </span>
        ) : null}
      </span>
      {action}
    </div>
  );
}

/** A read-out, not a control. `numeric` sends it through the mono/isolated
 *  treatment, which is what "16:9" and "720p" need inside Persian prose. */
export function Chip({ children, live = false, numeric = false }: { children: ReactNode; live?: boolean; numeric?: boolean }) {
  return (
    <span
      className={`rounded-[5px] px-2 py-1 text-[10.5px] ${numeric ? "vg-numeric" : ""}`}
      style={{
        background: live ? "var(--vg-primary-a18)" : "var(--vg-surface-overlay)",
        color: live ? "var(--vg-primary-soft)" : "var(--vg-text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

/** The 342px column both create panels sit in, on their `#131517`. */
export function PanelShell({ children }: { children: ReactNode }) {
  return (
    <aside
      /* `md:scroll-pb-24` for the same reason `html` carries scroll padding —
         above `md` this column is its own scroll container, so the page-level
         rule does not reach it and the footer would cover focus here instead. */
      className="flex w-full shrink-0 flex-col md:sticky md:top-11 md:max-h-[calc(100dvh-2.75rem)] md:w-[var(--vg-form-panel)] md:self-start md:overflow-y-auto md:scroll-pb-24"
      style={{ background: "var(--vg-deep)" }}
    >
      {children}
    </aside>
  );
}

/** Underline tabs, as their audio panel heads with. 2px on the active item. */
export function PanelTabs<T extends string>({
  tabs,
  active,
  onPick,
}: {
  tabs: { key: T; label: string; disabled?: boolean }[];
  active: T;
  onPick: (k: T) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => !t.disabled && onPick(t.key)}
            disabled={t.disabled}
            aria-current={on ? "page" : undefined}
            title={t.disabled ? "به‌زودی" : undefined}
            className="h-9 whitespace-nowrap text-[12.5px] font-semibold transition-colors disabled:opacity-40"
            style={{
              color: on ? "var(--vg-text)" : "var(--vg-text-muted)",
              borderBlockEnd: `2px solid ${on ? "var(--vg-text)" : "transparent"}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A full-width row that opens something: label on the start, value + caret on
 *  the end. Used for model and for any control with too many options to chip. */
