import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check } from "@phosphor-icons/react";

/* ---------------------------------------------------------------------------
   A menu that cannot be clipped by its ancestors.

   The docks put their option chips in a horizontally scrolling row. `overflow-x:
   auto` computes `overflow-y: auto` as well — the spec does not allow one axis
   to scroll while the other stays visible — so an absolutely positioned menu
   inside that row is cut to the row's height. A 288px model list inside a 40px
   chip row lost 248px of itself and `elementFromPoint` over it returned the
   image behind the dock: invisible and unclickable, while the state underneath
   worked perfectly.

   A portal to <body> is the fix that survives any ancestor. Position is `fixed`
   and measured from the trigger, so nothing above it in the tree can clip,
   scroll or stack over it.
   --------------------------------------------------------------------------- */

export interface PopoverOption {
  value: string | number;
  label: string;
  hint?: string;
}

export function PopoverMenu({
  anchor,
  options,
  value,
  onPick,
  onClose,
}: {
  anchor: HTMLElement | null;
  options: PopoverOption[];
  value: string;
  onPick: (v: string | number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure after paint but before the browser shows the frame, so the menu
  // never appears at 0,0 for a tick and then jumps.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    const gap = 8;
    // Above the trigger by default — these menus hang off docks pinned to the
    // bottom of the viewport, where there is never room below.
    let top = a.top - m.height - gap;
    if (top < 8) top = Math.min(a.bottom + gap, window.innerHeight - m.height - 8);
    // Align on the inline start: left edges in LTR, right edges in RTL.
    const rtl = document.documentElement.dir === "rtl";
    let left = rtl ? a.right - m.width : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    setPos({ top, left });
  }, [anchor, options.length]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      className="hide-scrollbar fixed z-[80] max-h-72 min-w-[180px] overflow-y-auto rounded-xl p-1"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        background: "var(--vg-surface-raised)",
        border: "1px solid var(--vg-border)",
        boxShadow: "0 16px 44px rgba(0,0,0,0.62)",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {options.map((o) => {
        const on = String(o.value) === value;
        return (
          <button
            key={String(o.value)}
            role="option"
            aria-selected={on}
            onClick={() => {
              onPick(o.value);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-white/5"
            style={{ color: on ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
          >
            <span className="flex-1 truncate">{o.label}</span>
            {o.hint && (
              <span className="shrink-0 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                {o.hint}
              </span>
            )}
            {on && <Check size={13} weight="bold" />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** Trigger + menu in one. The trigger holds its own ref so the menu can measure
 *  against it without the caller threading one through. */
export function PopoverChip({
  label,
  options,
  value,
  onPick,
  className,
  style,
}: {
  label: string;
  options: PopoverOption[];
  value: string;
  onPick: (v: string | number) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={className}
        style={style}
      >
        {label}
      </button>
      {open && (
        <PopoverMenu anchor={ref.current} options={options} value={value} onPick={onPick} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
