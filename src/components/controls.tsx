import { useEffect, useRef, useState } from "react";
import { Plus, X, Play, Pause, SpeakerHigh } from "@phosphor-icons/react";
import type { Control, RefSlot, SlotMedia } from "../data/models";
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

/** One picked input file — an image, a video or an audio clip. */
export interface RefFile {
  /** the real file — this is what gets uploaded once a backend exists */
  file: File;
  /** object URL for the preview only; revoked as soon as the file is dropped */
  url: string;
  /** Seconds, for video and audio. Motion Control is billed per second of the
   *  supplied clip, so its price cannot be quoted until this is known. */
  duration?: number;
}

/** Picked input files, keyed by RefSlot.key (the field name KIE expects). */
export type RefMap = Record<string, RefFile[]>;

const ACCEPT: Record<SlotMedia, string> = {
  image: "image/*",
  video: "video/mp4,video/quicktime,video/x-matroska",
  audio: "audio/mpeg,audio/wav",
};

/** How long to wait for metadata before giving up on a clip's length. */
const DURATION_TIMEOUT_MS = 4_000;

/**
 * Read a clip's length without playing it. Resolves undefined if unreadable.
 *
 * The timeout is load-bearing, not defensive. `video/x-matroska` and
 * `video/quicktime` are both in ACCEPT above and a browser that cannot decode
 * either may fire neither `loadedmetadata` nor `error` — leaving the promise
 * pending, `pick()` awaiting it, and the file the user chose never appearing at
 * all. Callers treat undefined as "unknown", which for a per-second model means
 * refusing to quote rather than guessing.
 */
function readDuration(url: string, media: SlotMedia): Promise<number | undefined> {
  if (media === "image") return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const el = document.createElement(media === "video" ? "video" : "audio");
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (d?: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Stop the probe fetching; the object URL itself stays valid for the preview.
      el.removeAttribute("src");
      resolve(d);
    };
    timer = setTimeout(() => done(undefined), DURATION_TIMEOUT_MS);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : undefined);
    el.onerror = () => done(undefined);
    el.src = url;
  });
}

/**
 * Reference / input file slot. Fully controlled — the owner holds the files so
 * they can actually reach the generation request (they used to die in local state).
 */
export function RefUpload({ slot, images, onChange }: { slot: RefSlot; images: RefFile[]; onChange: (i: RefFile[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const media: SlotMedia = slot.media ?? "image";

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    // Copy out of the live FileList before clearing the input — resetting
    // `value` empties the list itself, so reading it afterwards yields nothing.
    // Clearing is what lets a removed file be re-picked and still fire onChange.
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const next = [...images];
    let tooBig: string | null = null;
    for (const f of files) {
      if (next.length >= slot.max) break;
      // KIE publishes no enforced cap and no 413, so an over-sized file would be
      // accepted and only fail deep in the job — after the user has been charged.
      if (slot.maxMb != null && f.size > slot.maxMb * 1024 * 1024) {
        tooBig = `${faNum(slot.maxMb)} مگابایت`;
        continue;
      }
      const url = URL.createObjectURL(f);
      next.push({ file: f, url, duration: await readDuration(url, media) });
    }
    setRejected(tooBig);
    onChange(next);
  }

  function remove(i: number) {
    const f = images[i];
    if (f) URL.revokeObjectURL(f.url);
    setRejected(null);
    onChange(images.filter((_, idx) => idx !== i));
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-ink2">{slot.label}</span>
        {slot.maxMb != null && <span className="text-[11px] text-ink3">حداکثر {faNum(slot.maxMb)} مگابایت</span>}
      </div>
      <div className="flex flex-wrap gap-2.5">
        {images.map((f, i) => (
          <div key={f.url} className="relative h-[84px] w-[84px] overflow-hidden rounded-2xl border border-line bg-card2">
            {media === "image" && <img src={f.url} alt="" className="h-full w-full object-cover" />}
            {media === "video" && <video src={f.url} muted playsInline preload="metadata" className="h-full w-full object-cover" />}
            {media === "audio" && (
              <div className="grid h-full w-full place-items-center text-ink3">
                <SpeakerHigh size={22} />
              </div>
            )}
            {f.duration != null && (
              <span className="absolute bottom-1 start-1 rounded-full bg-bg/75 px-1.5 text-[10px] tabular-nums text-ink backdrop-blur-sm">
                {faNum(Math.round(f.duration))}s
              </span>
            )}
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
      {rejected && <span className="text-[11px] text-danger">فایل بزرگ‌تر از {rejected} رد شد</span>}
      <input ref={inputRef} type="file" accept={ACCEPT[media]} multiple={slot.max > 1} hidden onChange={pick} />
    </div>
  );
}
