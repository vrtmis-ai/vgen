import { useRef, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import type { Control, RefSlot } from "../data/models";
import { faNum } from "../lib/format";

export type InputValue = string | number | boolean;
export type InputMap = Record<string, InputValue>;

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12.5px] text-ink2">{label}</span>
      {children}
    </div>
  );
}

function ShapeIcon({ w, h, active }: { w: number; h: number; active: boolean }) {
  const s = 15 / Math.max(w, h);
  return (
    <span className="grid h-[17px] w-[17px] place-items-center">
      <span
        style={{
          width: Math.max(6, w * s),
          height: Math.max(6, h * s),
          borderRadius: 2.5,
          border: `1.5px solid ${active ? "#0a0a0b" : "currentColor"}`,
        }}
      />
    </span>
  );
}

function AspectPicker({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "aspect" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={control.label}>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        {control.options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-[12.5px] transition-colors active:scale-95 ${
                on ? "border-transparent bg-ink text-bg" : "border-line bg-card2 text-ink2"
              }`}
            >
              <ShapeIcon w={o.w} h={o.h} active={on} />
              {o.label}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

function Segmented({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "segment" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={control.label}>
      <div className="flex gap-1.5 rounded-2xl bg-card2 p-1">
        {control.options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              onClick={() => onChange(o.value)}
              className={`flex-1 rounded-[12px] py-2 text-[12.5px] transition-colors active:scale-[0.98] ${
                on ? "bg-ink font-medium text-bg" : "text-ink3"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </FieldShell>
  );
}

function SliderControl({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "slider" }>;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <FieldShell label={control.label}>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="min-w-[58px] rounded-lg bg-card2 px-2.5 py-1 text-center text-[12.5px] tabular-nums">
          {faNum(value)}
          {control.unit ? ` ${control.unit}` : ""}
        </span>
      </div>
    </FieldShell>
  );
}

function ToggleRow({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "toggle" }>;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="flex w-full items-center justify-between active:scale-[0.99]"
    >
      <span className="text-[13px] text-ink">{control.label}</span>
      <span className={`relative h-[26px] w-[44px] rounded-full transition-colors ${value ? "bg-ink" : "bg-card2"}`}>
        <span
          className="absolute top-[3px] h-[20px] w-[20px] rounded-full bg-bg transition-all"
          style={{ insetInlineStart: value ? 21 : 3, background: value ? "#0a0a0b" : "#74747d" }}
        />
      </span>
    </button>
  );
}

function NegText({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "text" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={control.label}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={control.placeholder}
        rows={2}
        className="ltr w-full resize-none rounded-2xl border border-line bg-card2 p-3 text-[13px] text-ink placeholder:text-ink3 focus:border-line2 focus:outline-none"
      />
    </FieldShell>
  );
}

export function ControlField({
  control,
  value,
  onChange,
}: {
  control: Control;
  value: InputValue;
  onChange: (key: string, v: InputValue) => void;
}) {
  switch (control.kind) {
    case "aspect":
      return <AspectPicker control={control} value={String(value)} onChange={(v) => onChange(control.key, v)} />;
    case "segment":
      return <Segmented control={control} value={String(value)} onChange={(v) => onChange(control.key, v)} />;
    case "slider":
      return (
        <SliderControl
          control={control}
          value={Number(value)}
          onChange={(v) => onChange(control.key, control.asString ? String(v) : v)}
        />
      );
    case "toggle":
      return <ToggleRow control={control} value={Boolean(value)} onChange={(v) => onChange(control.key, v)} />;
    case "text":
      return <NegText control={control} value={String(value ?? "")} onChange={(v) => onChange(control.key, v)} />;
  }
}

/** Reference / input image slot. Local preview only for now (KIE upload wired later). */
export function RefUpload({ slot, urls, onChange }: { slot: RefSlot; urls: string[]; onChange: (u: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>(urls);

  function pick(files: FileList | null) {
    if (!files) return;
    const next = [...previews];
    for (const f of Array.from(files)) {
      if (next.length >= slot.max) break;
      next.push(URL.createObjectURL(f));
    }
    setPreviews(next);
    onChange(next);
  }
  function remove(i: number) {
    const next = previews.filter((_, idx) => idx !== i);
    setPreviews(next);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12.5px] text-ink2">{slot.label}</span>
      <div className="flex flex-wrap gap-2.5">
        {previews.map((u, i) => (
          <div key={u} className="relative h-[84px] w-[84px] overflow-hidden rounded-2xl border border-line">
            <img src={u} alt="" className="h-full w-full object-cover" />
            <button
              onClick={() => remove(i)}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-bg/70 backdrop-blur-sm"
            >
              <X size={13} weight="bold" />
            </button>
          </div>
        ))}
        {previews.length < slot.max && (
          <button
            onClick={() => inputRef.current?.click()}
            className="grid h-[84px] w-[84px] place-items-center rounded-2xl border border-dashed border-line2 bg-card2 text-ink3 active:scale-95"
          >
            <Plus size={22} />
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple={slot.max > 1} hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}
