import { useEffect, useRef, useState } from "react";
import { Plus, X, Play, Pause } from "@phosphor-icons/react";
import type { Control, RefSlot } from "../data/models";
import { VOICES, voicePreviewUrl } from "../data/voices";
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
          border: `1.5px solid ${active ? "var(--color-on-accent)" : "currentColor"}`,
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
                on ? "border-transparent bg-accent font-medium text-on-accent" : "border-line bg-card2 text-ink2"
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
                on ? "bg-accent font-medium text-on-accent" : "text-ink3"
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
  // fill the track up to the thumb (slider is forced LTR, so "to right" is correct)
  const pct = ((value - control.min) / (control.max - control.min)) * 100;
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
          style={{ background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-line2) ${pct}%)` }}
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
      <span className={`relative h-[26px] w-[44px] rounded-full transition-colors ${value ? "bg-accent" : "bg-card2"}`}>
        <span
          className="absolute top-[3px] h-[20px] w-[20px] rounded-full transition-all"
          style={{ insetInlineStart: value ? 21 : 3, background: value ? "var(--color-on-accent)" : "var(--color-ink3)" }}
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
    case "voice":
      return <VoicePicker control={control} value={String(value ?? control.def)} onChange={(v) => onChange(control.key, v)} />;
  }
}

/**
 * Picking a voice by name alone is guesswork, so every row plays a sample.
 * The clips are KIE's own public previews — nothing is generated and no credits
 * are spent. A single shared <audio> means starting one preview stops the last.
 */
function VoicePicker({
  control,
  value,
  onChange,
}: {
  control: Extract<Control, { kind: "voice" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Stop on unmount, so switching model mid-preview doesn't leave a clip
  // playing with nothing on screen to stop it.
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
    },
    [],
  );

  function toggle(id: string) {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const el = new Audio(voicePreviewUrl(id));
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null); // a missing clip shouldn't strand the button
    audio.current = el;
    setPlaying(id);
    void el.play().catch(() => setPlaying(null));
  }

  return (
    <FieldShell label={control.label}>
      <div className="max-h-64 overflow-y-auto rounded-bezel border border-line bg-card">
        {VOICES.map((v) => {
          const on = v.id === value;
          return (
            <div
              key={v.id}
              className={`flex items-center gap-2 border-b border-line/50 px-3 py-2.5 last:border-0 ${on ? "bg-accent/10" : ""}`}
            >
              <button onClick={() => onChange(v.id)} className="flex-1 text-start active:scale-[0.99]">
                <div className={`text-[13px] ${on ? "font-medium text-accent" : "text-ink"}`}>{v.name}</div>
                <div className="text-[11px] text-ink3">{v.note}</div>
              </button>
              <button
                onClick={() => toggle(v.id)}
                aria-label={playing === v.id ? "توقف" : "پخش نمونه"}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-card2 text-ink2 active:scale-95"
              >
                {playing === v.id ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
              </button>
            </div>
          );
        })}
      </div>
    </FieldShell>
  );
}

/** One picked reference image. */
export interface RefImage {
  /** the real file — this is what gets uploaded once a backend exists */
  file: File;
  /** object URL for the thumbnail only; revoked as soon as the image is dropped */
  url: string;
}

/** Picked reference images, keyed by RefSlot.key (the field name KIE expects). */
export type RefMap = Record<string, RefImage[]>;

/**
 * Reference / input image slot. Fully controlled — the owner holds the images so
 * they can actually reach the generation request (they used to die in local state).
 */
export function RefUpload({ slot, images, onChange }: { slot: RefSlot; images: RefImage[]; onChange: (i: RefImage[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (files) {
      const next = [...images];
      for (const f of Array.from(files)) {
        if (next.length >= slot.max) break;
        next.push({ file: f, url: URL.createObjectURL(f) });
      }
      onChange(next);
    }
    // clear the input so removing a file and re-picking it still fires onChange
    e.target.value = "";
  }
  function remove(i: number) {
    const img = images[i];
    if (img) URL.revokeObjectURL(img.url);
    onChange(images.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12.5px] text-ink2">{slot.label}</span>
      <div className="flex flex-wrap gap-2.5">
        {images.map((img, i) => (
          <div key={img.url} className="relative h-[84px] w-[84px] overflow-hidden rounded-2xl border border-line">
            <img src={img.url} alt="" className="h-full w-full object-cover" />
            <button
              onClick={() => remove(i)}
              className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-bg/70 backdrop-blur-sm"
            >
              <X size={13} weight="bold" />
            </button>
          </div>
        ))}
        {images.length < slot.max && (
          <button
            onClick={() => inputRef.current?.click()}
            className="grid h-[84px] w-[84px] place-items-center rounded-2xl border border-dashed border-line2 bg-card2 text-ink3 active:scale-95"
          >
            <Plus size={22} />
          </button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple={slot.max > 1} hidden onChange={pick} />
    </div>
  );
}
