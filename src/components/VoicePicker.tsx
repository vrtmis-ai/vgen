import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MagnifyingGlass, Play, Pause, Check, SpinnerGap } from "@phosphor-icons/react";
import { VOICES, voicePreviewUrl, type Voice } from "../data/voices";

/* ---------------------------------------------------------------------------
   The voice picker.

   It was a bare <select> of 46 names. Choosing a voice by reading "Bradford"
   is guesswork — the one thing that decides the choice is what it sounds like,
   and the catalog has carried a free, public, no-auth preview URL for every
   voice this whole time. `voicePreviewUrl` existed and nothing called it.

   So the picker plays. One <audio> element for the whole list, retargeted on
   each row, because 46 elements is 46 connections and only one can be audible
   anyway. Playing a second row stops the first — a picker that lets two voices
   overlap is not a picker.

   Rows carry the spec's own one-line character description, which is the other
   half of the decision and was also being thrown away.
   --------------------------------------------------------------------------- */

type Load = { id: string; state: "loading" | "playing" } | null;

function Row({
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
  const playing = load?.id === voice.id && load.state === "playing";
  const loading = load?.id === voice.id && load.state === "loading";
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.05]"
      style={selected ? { background: "rgba(233,95,24,0.12)" } : undefined}
    >
      <button
        onClick={onPreview}
        aria-label={`${playing ? "توقف" : "پخش نمونه"} ${voice.name}`}
        className="grid size-9 shrink-0 place-items-center rounded-full transition-colors"
        style={{
          background: playing ? "var(--vg-primary)" : "var(--vg-surface-overlay)",
          color: playing ? "var(--vg-text-on-primary)" : "var(--vg-text)",
        }}
      >
        {loading ? <SpinnerGap size={15} className="animate-spin" /> : playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
      </button>

      <button onClick={onPick} className="flex min-w-0 flex-1 flex-col items-start text-start">
        {/* The name is Latin inside an RTL line — bdi keeps its punctuation
            attached to it rather than to the description that follows. */}
        <bdi className="vg-numeric truncate text-[13px] tracking-[0.06em]" style={{ color: selected ? "var(--vg-primary-soft)" : "var(--vg-text)" }}>
          {voice.name}
        </bdi>
        <span className="mt-0.5 truncate text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
          {voice.note}
        </span>
      </button>

      {selected && <Check size={14} weight="bold" className="shrink-0" style={{ color: "var(--vg-primary-soft)" }} />}
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

  // One element, retargeted. Also stops whatever is playing when the sheet
  // closes — audio outliving its UI is the classic version of this bug.
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
      el.pause();
      el.src = "";
      el.removeEventListener("playing", onPlay);
      el.removeEventListener("ended", clear);
      el.removeEventListener("error", clear);
    };
  }, []);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);

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

  return createPortal(
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center" style={{ background: "rgba(9,9,9,0.9)" }} onClick={onClose}>
      <div
        className="flex max-h-[86dvh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
              انتخاب صدا
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
              گوش بده و انتخاب کن. شنیدن نمونه رایگان است و سکه‌ای کم نمی‌کند.
            </p>
          </div>
          <button onClick={onClose} aria-label="بستن" className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ color: "var(--vg-text-muted)" }}>
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex h-9 items-center gap-2 rounded-lg px-2.5" style={{ background: "var(--vg-canvas)", border: "1px solid var(--vg-border-subtle)" }}>
            <MagnifyingGlass size={13} style={{ color: "var(--vg-text-faint)" }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجوی نام یا لحن"
              className="w-full bg-transparent text-[12.5px] outline-none"
              style={{ color: "var(--vg-text)" }}
            />
          </div>
        </div>

        <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {shown.map((v) => (
            <Row
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
            <p className="py-10 text-center text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              صدایی با این نام نیست.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
