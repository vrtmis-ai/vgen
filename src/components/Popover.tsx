import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check } from "@phosphor-icons/react";
import { useFloatingDismiss, useFloatingPosition } from "./FloatingSurface";

export interface PopoverOption {
  value: string | number;
  label: string;
  hint?: string;
}

const surfaceStyle = (position: { top: number; left: number } | null): CSSProperties => ({
  top: position?.top ?? -9999,
  left: position?.left ?? -9999,
  background: "var(--vg-surface-raised)",
  border: "1px solid var(--vg-border)",
  boxShadow: "0 16px 44px rgba(0,0,0,0.62)",
  visibility: position ? "visible" : "hidden",
});

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
  onPick: (value: string | number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useFloatingPosition(anchor, ref, String(options.length));
  useFloatingDismiss({ anchor, surfaceRef: ref, onClose });

  useLayoutEffect(() => {
    const choices = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    (choices.find((choice) => choice.getAttribute("aria-selected") === "true") ?? choices[0])?.focus({ preventScroll: true });
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const choices = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role='option']") ?? []);
    if (!choices.length) return;
    const current = Math.max(0, choices.indexOf(document.activeElement as HTMLButtonElement));
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (current + 1) % choices.length;
    if (event.key === "ArrowUp") next = (current - 1 + choices.length) % choices.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = choices.length - 1;
    if (next === null) return;
    event.preventDefault();
    choices[next]?.focus();
  };

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      onKeyDown={moveFocus}
      className="hide-scrollbar fixed z-[80] max-h-72 min-w-[180px] overflow-y-auto rounded-xl p-1"
      style={surfaceStyle(position)}
    >
      {options.map((option) => {
        const selected = String(option.value) === value;
        return (
          <button
            key={String(option.value)}
            role="option"
            aria-selected={selected}
            onClick={() => {
              onPick(option.value);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start text-[13px] transition-colors hover:bg-white/5"
            style={{ color: selected ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
          >
            <span className="flex-1 truncate">{option.label}</span>
            {option.hint && (
              <span className="shrink-0 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                {option.hint}
              </span>
            )}
            {selected && <Check size={13} weight="bold" />}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export function PopoverSlider({
  anchor,
  label,
  min,
  max,
  step,
  unit,
  value,
  onChange,
  onClose,
}: {
  anchor: HTMLElement | null;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string | undefined;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useFloatingPosition(anchor, ref);
  useFloatingDismiss({ anchor, surfaceRef: ref, onClose });
  useLayoutEffect(() => ref.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true }), []);
  const marks = [min, Math.round((min + max) / 2), max];

  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className="fixed z-[80] w-[248px] rounded-xl p-3.5" style={surfaceStyle(position)}>
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
          {label}
        </span>
        <span className="text-[15px] font-bold" style={{ color: "var(--vg-primary-soft)" }}>
          <span className="vg-numeric">{value}</span>
          {unit ? <span className="ms-1 text-[11px] font-normal">{unit}</span> : null}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
        aria-label={label}
      />
      <div className="mt-1.5 flex justify-between">
        {marks.map((mark) => (
          <button
            key={mark}
            onClick={() => onChange(mark)}
            className="vg-numeric text-[10.5px]"
            style={{ color: mark === value ? "var(--vg-primary-soft)" : "var(--vg-text-faint)" }}
          >
            {mark}
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}

export function PopoverChip({
  label,
  options,
  value,
  onPick,
  range,
  className,
  style,
}: {
  label: string;
  options: PopoverOption[];
  value: string;
  onPick: (value: string | number) => void;
  range?: { min: number; max: number; step: number; unit?: string | undefined; title: string } | null | undefined;
  className?: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup={range ? "dialog" : "listbox"}
        aria-expanded={open}
        className={className}
        style={style}
      >
        {label}
      </button>
      {open &&
        (range ? (
          <PopoverSlider
            anchor={ref.current}
            label={range.title}
            min={range.min}
            max={range.max}
            step={range.step}
            unit={range.unit}
            value={Number(value)}
            onChange={onPick}
            onClose={() => setOpen(false)}
          />
        ) : (
          <PopoverMenu anchor={ref.current} options={options} value={value} onPick={onPick} onClose={() => setOpen(false)} />
        ))}
    </>
  );
}
