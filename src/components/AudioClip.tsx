import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Copy, DownloadSimple } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   A finished audio file, on screen.

   Shared by the audio studio's history and کارهای من. The gallery used to draw
   audio as a picture — a gradient tile at a made-up 16:9, opening an image
   viewer that put the file in an <img>, printed its "dimensions" and offered to
   turn it into a video. A sound has no frame; what it has is a length and a
   play button.
   --------------------------------------------------------------------------- */

/** A deterministic waveform. Seeded off the id so a card looks the same on
 *  every render — Math.random here would animate on each paint. */
function bars(seed: string, n = 56): number[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const base = 0.25 + ((h >>> 16) % 1000) / 1400;
    // Taper the ends so it reads as a clip rather than a bar chart.
    const env = Math.sin((Math.PI * (i + 1)) / (n + 1)) ** 0.45;
    return Math.max(0.08, base * env);
  });
}

/** One playable file. A Suno request is two of these from one generation. */
export interface Clip {
  id: string;
  prompt: string;
  /** The model, in the wide monospace line. */
  voice: string;
  /** Which take, when a request made more than one. Kept out of `voice` so
   *  truncating a long model name cannot cut it off and leave two identical
   *  cards. */
  take: number | null;
  /** Unknown until the server has measured the file. */
  seconds: number | null;
  url: string | undefined;
  /** Where the download route finds it: the job and the output's position. */
  jobId: string | undefined;
  index: number;
}

/** Every take is a clip. Suno answers one request with two, and listing only
 *  the first would hide half of what was paid for. */
export function clipsOf(g: Generation): Clip[] {
  return [{ url: g.outputUrl, durationMs: g.durationMs }, ...(g.moreOutputs ?? [])].map((take, index, takes) => ({
    id: index === 0 ? g.id : `${g.id}:${index}`,
    prompt: g.prompt,
    voice: g.name.toUpperCase(),
    take: takes.length > 1 ? index + 1 : null,
    seconds: take.durationMs ? Math.round(take.durationMs / 1000) : null,
    url: take.url,
    jobId: g.jobId,
    index,
  }));
}

/**
 * How far through `audio` is, 0 to 1, redrawn every frame while it plays.
 *
 * Read here, in the one card that is playing, rather than in the player hook:
 * sixty updates a second at the screen's root would re-render the whole
 * studio. Held beside the element it was read from, so the next clip starts
 * at zero instead of flashing the last one's end for a frame.
 */
function useProgress(audio: HTMLAudioElement | null): number {
  const [read, setRead] = useState<{ audio: HTMLAudioElement; at: number } | null>(null);
  useEffect(() => {
    if (!audio) return;
    let frame = requestAnimationFrame(function tick() {
      setRead({ audio, at: audio.duration ? audio.currentTime / audio.duration : 0 });
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [audio]);
  return audio && read?.audio === audio ? read.at : 0;
}

/**
 * The waveform. Laid out left to right whatever the page's direction — time
 * runs left to right on every player there is — and filled up to where
 * playback has reached.
 */
function Wave({ data, audio, className }: { data: number[]; audio: HTMLAudioElement | null; className: string }) {
  const progress = useProgress(audio);
  return (
    <span dir="ltr" className={className} aria-hidden>
      {data.map((v, i) => (
        <span
          key={i}
          className="flex-1 rounded-full"
          style={{
            height: `${Math.round(v * 100)}%`,
            background: audio && i / data.length < progress ? "var(--vg-primary)" : "var(--vg-border-strong)",
          }}
        />
      ))}
    </span>
  );
}

export function WaveCard({
  clip,
  list,
  audio,
  onPlay,
  onDownload,
}: {
  clip: Clip;
  list: boolean;
  /** The element playing this clip, or null when it is not the one playing. */
  audio: HTMLAudioElement | null;
  onPlay: () => void;
  onDownload: (() => void) | undefined;
}) {
  const { n } = useI18n();
  const { id, prompt, seconds } = clip;
  const voice = clip.take === null ? clip.voice : `${clip.voice} · ${clip.take}`;
  const playing = audio !== null;
  const data = useMemo(() => bars(id, list ? 120 : 56), [id, list]);
  const time = seconds === null ? "--:--" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const PlayIcon = playing ? Pause : Play;
  // Named for the clip. A history of six results is otherwise six buttons all
  // called "پخش", which on screen is unambiguous — each sits in its own row —
  // and in a screen reader's button list is not.
  const playLabel = `${playing ? "توقف" : "پخش"} — ${voice}`;

  const actions = [
    { Icon: Copy, label: "رونوشت متن", onClick: () => void navigator.clipboard?.writeText(prompt), secondary: true },
    ...(onDownload ? [{ Icon: DownloadSimple, label: "دانلود", onClick: onDownload, secondary: false }] : []),
  ];

  /* Their History row, measured: 74px tall, NO card background — just a divider
     — a 40px play, a wide waveform that takes all the slack, then the model and
     the actions. The waveform being the widest thing in the row is the whole
     design: it is the only part of an audio result you can read at a glance. */
  if (list) {
    return (
      <div className="group flex h-[74px] items-center gap-3 border-b px-2" style={{ borderColor: "var(--vg-border-subtle)" }}>
        <button
          onClick={onPlay}
          disabled={!clip.url}
          aria-label={playLabel}
          aria-pressed={playing}
          className="grid size-10 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-40"
          style={{
            background: playing ? "var(--vg-primary)" : "var(--vg-surface-overlay)",
            color: playing ? "var(--vg-text-on-primary)" : "var(--vg-text)",
          }}
        >
          <PlayIcon size={14} weight="fill" />
        </button>

        {/* Widest fixed part of the row, so it needs the most canvas: only once
            the container itself can spare 200px on top of everything else. */}
        <div className="hidden w-[200px] shrink-0 @2xl:block">
          <bdi className="vg-numeric flex text-[12.5px] tracking-[0.1em]" style={{ color: "var(--vg-text)" }}>
            <span className="truncate">{clip.voice}</span>
            {clip.take !== null && <span className="shrink-0">&nbsp;· {clip.take}</span>}
          </bdi>
          <span className="block truncate text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
            {prompt}
          </span>
        </div>

        <Wave data={data} audio={audio} className="flex h-9 min-w-0 flex-1 items-center gap-[1.5px]" />

        <span className="vg-numeric hidden shrink-0 text-[11.5px] @lg:block" style={{ color: "var(--vg-text-muted)" }}>
          {time}
        </span>

        {/* Below `md` only download survives: the row's fixed parts come to
            more than a phone can hold beside a waveform, and copying the text
            is the one that can wait for a wider screen. */}
        <span className="flex shrink-0 items-center gap-0.5">
          {actions.map(({ Icon, label, onClick, secondary }) => (
            <button
              key={label}
              onClick={onClick}
              aria-label={`${label} — ${voice}`}
              title={label}
              className={`${secondary ? "hidden @md:grid" : "grid"} size-7 place-items-center rounded-lg`}
              style={{ color: "var(--vg-text-muted)" }}
            >
              <Icon size={15} />
            </button>
          ))}
        </span>
      </div>
    );
  }

  return (
    <div
      className="group relative flex flex-col justify-end overflow-hidden rounded-xl p-4"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", minHeight: 190 }}
    >
      <Wave data={data} audio={audio} className="mb-auto flex h-[86px] items-center gap-[2px]" />
      {/* The take on its own tag: a card is too narrow for "SUNO SOUNDS · 2"
          in wide monospace, and truncation left two identical cards. */}
      {clip.take !== null && (
        <span
          className="absolute top-2 rounded-full px-2 py-0.5 text-[10px]"
          style={{ insetInlineStart: "0.5rem", background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
        >
          نسخهٔ {n(clip.take)}
        </span>
      )}

      <button
        onClick={onPlay}
        disabled={!clip.url}
        aria-label={playLabel}
        aria-pressed={playing}
        className={`absolute inset-0 grid place-items-center transition-opacity group-hover:opacity-100 focus-visible:opacity-100 ${playing ? "opacity-100" : "opacity-0"}`}
        // Lighter while playing, so the fill is readable under it.
        style={{ background: playing ? "rgba(0,0,0,0.12)" : "rgba(0,0,0,0.35)" }}
      >
        <span
          className="grid size-11 place-items-center rounded-full"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          <PlayIcon size={17} weight="fill" />
        </span>
      </button>

      <p className="line-clamp-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        {prompt}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        {/* Wide monospace for the model, as the reference does — it makes a
            list of near-identical names scannable by shape. */}
        <bdi className="vg-numeric truncate text-[15px] tracking-[0.14em]" style={{ color: "var(--vg-text)" }}>
          {clip.voice}
        </bdi>
        {onDownload && (
          <button
            onClick={onDownload}
            aria-label={`دانلود — ${voice}`}
            title="دانلود"
            className="relative grid size-7 shrink-0 place-items-center rounded-lg"
            style={{ color: "var(--vg-text-muted)" }}
          >
            <DownloadSimple size={15} />
          </button>
        )}
        {/* A clock reading is a numeric value, so it stays Latin and tabular
            like every other one — `n()` takes a number and this is a string. */}
        <span className="vg-numeric shrink-0 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
          {time}
        </span>
      </div>
    </div>
  );
}

/**
 * One audio element for the whole canvas, as the voice picker has: starting one
 * clip stops the last, and leaving the page stops whatever was playing.
 */
export function useClipPlayer() {
  const [current, setCurrent] = useState<{ id: string; audio: HTMLAudioElement } | null>(null);
  // For the unmount cleanup, which must not close over a stale `current`.
  const live = useRef<HTMLAudioElement | null>(null);

  useEffect(() => () => live.current?.pause(), []);

  function stop() {
    live.current?.pause();
    live.current = null;
    setCurrent(null);
  }

  function toggle(clip: Clip) {
    if (current?.id === clip.id || !clip.url) {
      stop();
      return;
    }
    live.current?.pause();
    const audio = new Audio(clip.url);
    // Guarded: a clip that was replaced by another must not clear its successor.
    const end = () => setCurrent((now) => (now?.audio === audio ? null : now));
    audio.onended = end;
    // A link past its signature should not strand the button on "stop".
    audio.onerror = end;
    live.current = audio;
    setCurrent({ id: clip.id, audio });
    void audio.play().catch(end);
  }

  /** The element playing `clip`, or null. What `WaveCard` takes as `audio`. */
  const audioOf = (clip: Clip) => (current?.id === clip.id ? current.audio : null);

  return { audioOf, toggle, stop };
}

/**
 * Save a take, through the API rather than straight at the file: `download` on
 * an anchor is ignored across origins, and the file is signed against the
 * object store's. The route answers with an attachment.
 */
export function downloadClip(downloadUrl: (jobId: string, index?: number) => string, clip: Clip): void {
  if (!clip.jobId || !clip.url) return;
  const el = document.createElement("a");
  el.href = downloadUrl(clip.jobId, clip.index);
  el.rel = "noopener";
  el.click();
}
