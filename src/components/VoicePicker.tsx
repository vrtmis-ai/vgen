import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MagnifyingGlass, Play, Pause, SpinnerGap, Sparkle } from "@phosphor-icons/react";
import { VOICES, voicePreviewUrl, type Voice } from "../data/voices";
import { useModalSurface } from "./FloatingSurface";

/* ---------------------------------------------------------------------------
   The voice picker.

   Rebuilt after measuring theirs. The first version was a vertical list of 46
   rows; theirs is a 3-column CARD grid, and the difference is the point — a
   voice is picked the way a face is picked, by scanning, not by reading down a
   column.

   Measured off /audio: panel 649x540, card 204x108 at radius 12 on #131416 with
   4px padding, a 42px circular orb, 10px gutters, three across. Each card
   carries its own play button and waveform strip, so a preview is one click
   from anywhere in the grid rather than a row you have to find first.

   The previews are real. `voicePreviewUrl` gives every voice a free, public,
   no-auth sample and nothing was calling it. One <audio> element retargeted per
   card — 46 elements would be 46 connections and only one can be audible.
   --------------------------------------------------------------------------- */

/** A calm two-stop orb per voice, deterministic from the id. Stands in for the
 *  portrait art theirs uses; a flat grey circle would read as a missing image. */
function orb(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  return `linear-gradient(140deg, hsl(${a} 70% 62%), hsl(${(a + 40) % 360} 65% 42%))`;
}

/** A short static waveform so the card has the same silhouette theirs does. */
function bars(id: string, n = 34): number[] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.3 + ((h >>> 16) % 1000) / 1600;
    const env = Math.sin((Math.PI * (i + 1)) / (n + 1)) ** 0.4;
    return Math.max(0.12, base * env);
  });
}

type Load = { id: string; state: "loading" | "playing" } | null;

function VoiceCard({
  voice,
  selected,
  load,
  onPreview,
  onPick,
}: {
  voice: Voice;
  selected: boolean;
  load: Load;
  onPreview: () => void;
  onPick: () => void;
}) {
  const wave = useMemo(() => bars(voice.id), [voice.id]);
  const playing = load?.id === voice.id && load.state === "playing";
  const loading = load?.id === voice.id && load.state === "loading";

  return (
    <div
      className="relative flex h-[108px] flex-col rounded-xl p-1 transition-colors"
      style={{
        background: "var(--vg-deep)",
        outline: selected ? "2px solid var(--vg-primary)" : "1px solid var(--vg-border-subtle)",
        outlineOffset: selected ? "-2px" : "-1px",
      }}
    >
      <button
        data-voice-option
        aria-pressed={selected}
        onClick={onPick}
        className="flex flex-1 items-center gap-2.5 rounded-lg p-2 text-start"
      >
        <span className="size-[42px] shrink-0 rounded-full" style={{ background: orb(voice.id) }} aria-hidden />
        <span className="min-w-0">
          <bdi
            className="vg-numeric block truncate text-[13px] font-semibold"
            style={{ color: selected ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
          >
            {voice.name}
          </bdi>
          <span className="mt-0.5 block truncate text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
            {voice.note}
          </span>
        </span>
      </button>

      {/* Play sits on the card, not on a row you have to locate first. */}
      <div className="flex items-center gap-2 px-2 pb-1">
        <button
          onClick={onPreview}
          aria-label={`${playing ? "توقف" : "پخش نمونهٔ"} ${voice.name}`}
          className="grid size-6 shrink-0 place-items-center rounded-full"
          style={{
            background: playing ? "var(--vg-primary)" : "var(--vg-surface-overlay)",
            color: playing ? "var(--vg-text-on-primary)" : "var(--vg-text)",
          }}
        >
          {loading ? (
            <SpinnerGap size={11} className="animate-spin" />
          ) : playing ? (
            <Pause size={10} weight="fill" />
          ) : (
            <Play size={10} weight="fill" />
          )}
        </button>
        <span className="flex h-4 flex-1 items-center gap-[1.5px]" aria-hidden>
          {wave.map((v, i) => (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{
                height: `${Math.round(v * 100)}%`,
                background: playing ? "var(--vg-primary-soft)" : "var(--vg-border-strong)",
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}

export function VoicePicker({
  selectedId,
  onPick,
  onClose,
}: {
  selectedId: string | null;
  onPick: (v: Voice) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [load, setLoad] = useState<Load>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useModalSurface({ surfaceRef: dialogRef, onClose, initialFocusRef: searchRef });

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    audio.current = el;
    const onPlay = () => setLoad((l) => (l ? { ...l, state: "playing" } : l));
    const clear = () => setLoad(null);
    el.addEventListener("playing", onPlay);
    el.addEventListener("ended", clear);
    el.addEventListener("error", clear);
    return () => {
      // Stop on unmount: audio outliving its UI is the classic version of this.
      el.pause();
      el.src = "";
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("ended", clear);
      el.removeEventListener("error", clear);
    };
  }, []);

  const preview = (v: Voice) => {
    const el = audio.current;
    if (!el) return;
    if (load?.id === v.id) {
      el.pause();
      setLoad(null);
      return;
    }
    el.pause();
    el.src = voicePreviewUrl(v.id);
    setLoad({ id: v.id, state: "loading" });
    void el.play().catch(() => setLoad(null));
  };

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? VOICES.filter((v) => v.name.toLowerCase().includes(s) || v.note.includes(q.trim())) : VOICES;
  }, [q]);

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const cards = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-voice-option]") ?? []);
    if (!cards.length) return;
    const current = cards.indexOf(document.activeElement as HTMLButtonElement);
    const rtl = document.documentElement.dir === "rtl";
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(cards.length - 1, current + 3);
    if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(0, current - 3);
    if (event.key === "ArrowRight") next = current < 0 ? 0 : (current + (rtl ? -1 : 1) + cards.length) % cards.length;
    if (event.key === "ArrowLeft") next = current < 0 ? 0 : (current + (rtl ? 1 : -1) + cards.length) % cards.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = cards.length - 1;
    event.preventDefault();
    cards[next]?.focus();
  };

  return createPortal(
    <div
      data-modal-root
      className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(9,9,9,0.9)" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-picker-title"
        tabIndex={-1}
        onKeyDown={moveFocus}
        className="flex max-h-[88dvh] w-full max-w-[680px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Their header block: a big line, a supporting line, and the one action
            that is not "pick an existing voice". */}
        <div className="relative flex items-start gap-4 p-5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          <div className="min-w-0 flex-1">
            <h2
              id="voice-picker-title"
              className="text-[21px] font-extrabold leading-tight"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              یک صدا انتخاب کن
            </h2>
            <p className="mt-1 max-w-[46ch] text-[12.5px] leading-5" style={{ color: "var(--vg-text-muted)" }}>
              از میان صداهای آماده بشنو و انتخاب کن. شنیدن نمونه رایگان است و سکه‌ای کم نمی‌کند.
            </p>
            {/* Voice cloning is theirs, not ours — shown so the gap is visible,
                disabled because there is nothing behind it. */}
            <button
              disabled
              title="به‌زودی"
              className="mt-3 flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-faint)" }}
            >
              <Sparkle size={13} weight="fill" />
              ساخت صدای اختصاصی — به‌زودی
            </button>
          </div>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ color: "var(--vg-text-muted)" }}
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex items-center gap-2 px-5 py-3">
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
            صداها
          </span>
          <span className="vg-numeric text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
            {shown.length}
          </span>
          <div
            className="ms-auto flex h-8 w-[180px] items-center gap-2 rounded-lg px-2.5"
            style={{ background: "var(--vg-canvas)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <MagnifyingGlass size={12} style={{ color: "var(--vg-text-muted)" }} />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجو"
              className="w-full bg-transparent text-[12px] outline-none"
              style={{ color: "var(--vg-text)" }}
            />
          </div>
        </div>

        {/* Three across, as theirs is — 204px cards with 10px gutters. */}
        <div className="hide-scrollbar grid min-h-0 flex-1 grid-cols-2 gap-2.5 overflow-y-auto px-5 pb-5 sm:grid-cols-3">
          {shown.map((v) => (
            <VoiceCard
              key={v.id}
              voice={v}
              selected={v.id === selectedId}
              load={load}
              onPreview={() => preview(v)}
              onPick={() => {
                onPick(v);
                onClose();
              }}
            />
          ))}
          {shown.length === 0 && (
            <p className="col-span-full py-10 text-center text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              صدایی با این نام نیست.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
