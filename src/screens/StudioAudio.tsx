import { useMemo, useState } from "react";
import { Heart, Sparkle, Play } from "@phosphor-icons/react";
import { FAMILIES, type Family, type Variant } from "../data/models";
import type { InputMap } from "../components/controls";
import { useCreateState, valueLabel, sliderSteps, rangeOf } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { VOICES } from "../data/voices";
import { VoicePicker } from "../components/VoicePicker";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { CoinMark } from "../components/chrome";
import { PopoverChip } from "../components/Popover";
import { ModelChip } from "../components/ModelPicker";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The audio studio — a third architecture, not a recolour of the other two.

   /audio runs a 48px icon RAIL on the inline start (not a 320px panel), a
   filter row across the top, a grid of waveform cards as the canvas, and a
   floating dock measured at 718x112, radius 20, on `rgba(255,255,255,.05)` with
   12px padding — the compact recipe, not the image studio's glass card.

   The card is the part worth copying. An audio result has no thumbnail, so
   theirs shows a waveform, the prompt above it, and the voice name in a wide
   monospace display face with the duration on the end. That is the whole
   reason this modality needs its own screen: a grid built for pictures has
   nothing to put in the picture.

   One deliberate omission. Their dock opens with a circular dial carrying
   Voiceover / Change Voice / Translate. Those are three products we do not
   have — VGen's audio catalog is text-to-speech and nothing else — so copying
   the dial would draw controls with nothing behind them. The voice preset card
   beside Generate is kept, because that one maps onto a real control.
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

function WaveCard({ id, prompt, voice, seconds, list }: { id: string; prompt: string; voice: string; seconds: number; list?: boolean }) {
  const data = useMemo(() => bars(id, list ? 96 : 56), [id, list]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  /* List view is a different card, not a squashed one: the waveform becomes a
     thin strip and the metadata runs beside it, which is the shape that lets
     you read twelve prompts down a column. */
  if (list) {
    return (
      <div
        className="group relative flex items-center gap-4 overflow-hidden rounded-xl px-4 py-3"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
      >
        <button
          aria-label="پخش"
          className="grid size-9 shrink-0 place-items-center rounded-full"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          <Play size={14} weight="fill" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px]" style={{ color: "var(--vg-text)" }}>
            {prompt}
          </p>
          <div className="mt-1.5 flex h-5 items-center gap-[1.5px]" aria-hidden>
            {data.map((v, i) => (
              <span key={i} className="flex-1 rounded-full" style={{ height: `${Math.round(v * 100)}%`, background: "var(--vg-border-strong)" }} />
            ))}
          </div>
        </div>
        <bdi className="vg-numeric hidden shrink-0 text-[12.5px] tracking-[0.12em] sm:block" style={{ color: "var(--vg-text-muted)" }}>
          {voice}
        </bdi>
        <span className="vg-numeric shrink-0 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
          {mm}:{ss}
        </span>
      </div>
    );
  }

  return (
    <div
      className="group relative flex flex-col justify-end overflow-hidden rounded-xl p-4"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", minHeight: 190 }}
    >
      <div className="mb-auto flex h-[86px] items-center gap-[2px]" aria-hidden>
        {data.map((v, i) => (
          <span
            key={i}
            className="flex-1 rounded-full"
            style={{ height: `${Math.round(v * 100)}%`, background: "var(--vg-border-strong)" }}
          />
        ))}
      </div>

      <button
        className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100"
        style={{ background: "rgba(0,0,0,0.35)" }}
        aria-label="پخش"
      >
        <span className="grid size-11 place-items-center rounded-full" style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}>
          <Play size={17} weight="fill" />
        </span>
      </button>

      <p className="line-clamp-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        {prompt}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        {/* Wide monospace for the voice name, as the reference does — it makes a
            list of near-identical names scannable by shape. */}
        <span className="vg-numeric truncate text-[15px] tracking-[0.14em]" style={{ color: "var(--vg-text)" }}>
          {voice}
        </span>
        {/* A clock reading is a numeric value, so it stays Latin and tabular
            like every other one — `n()` takes a number and this is a string. */}
        <span className="vg-numeric shrink-0 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
          {mm}:{ss}
        </span>
      </div>
    </div>
  );
}

const CHIP_CLASS = "flex h-8 shrink-0 items-center rounded-lg px-2.5 text-[12px] font-semibold";

const SEED_CLIPS = [
  { id: "a1", prompt: "یک دو سه داستانت رو عمودی روایت کن", voice: "ARIA", seconds: 9 },
  { id: "a2", prompt: "خوش آمدید به اولین قسمت از پادکست ما", voice: "ROMAN", seconds: 119 },
  { id: "a3", prompt: "تخفیف ویژه‌ی پایان فصل، فقط تا جمعه", voice: "ARTHUR", seconds: 27 },
  { id: "a4", prompt: "راوی مستند: در دل کویر، چیزی تکان می‌خورد", voice: "SARAH", seconds: 42 },
  { id: "a5", prompt: "معرفی محصول جدید با لحن گرم و صمیمی", voice: "LAURA", seconds: 15 },
  { id: "a6", prompt: "اعلان فرودگاه: پرواز شماره ۷۲۳ آماده‌ی سوار شدن است", voice: "GEORGE", seconds: 8 },
];

export default function StudioAudio({
  gens,
  onGenerate,
}: {
  gens: Generation[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
}) {
  const { n } = useI18n();
  const families = FAMILIES.filter((f) => f.kind === "audio");
  const s = useCreateState(families);
  const [tab, setTab] = useState<"all" | "liked">("all");
  const [pickVoice, setPickVoice] = useState(false);
  const view = useViewMode("audio", { mode: "grid", density: 1 });

  const mine = gens.filter((g) => g.kind === "audio");
  const clips =
    mine.length > 0
      ? mine.map((g) => ({ id: g.id, prompt: g.prompt, voice: g.name.toUpperCase(), seconds: Math.round((g.durationMs ?? 12000) / 1000) }))
      : SEED_CLIPS;

  const voiceControl = s.controls.find((c) => c.kind === "voice");
  const voiceId = voiceControl ? String(s.input[voiceControl.key]) : null;
  const voice = VOICES.find((v) => v.id === voiceId);

  return (
    /* The 48px rail is gone. It held two icons that switched nothing — a guess
       at the reference's rail before the real view controls existed — and once
       those landed the rail's "نمای شبکه‌ای" became a second control with the
       same accessible name as the one that works. Two identically-named buttons
       where only one does anything is worse than no rail: a screen-reader user
       cannot tell them apart, and a sighted user picks the dead one half the
       time. Removing it also gives the clip grid the full width. */
    <div className="flex">
      <main className="min-w-0 flex-1">
        <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          {([["all", "همه"], ["liked", "پسندیده"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold"
              style={{
                background: tab === k ? "var(--vg-surface-overlay)" : "transparent",
                color: tab === k ? "var(--vg-text)" : "var(--vg-text-muted)",
              }}
            >
              {k === "liked" && <Heart size={13} />}
              {label}
            </button>
          ))}
          <div className="ms-auto">
            <ViewControls mode={view.mode} density={view.density} onMode={view.setMode} onDensity={view.setDensity} />
          </div>
        </div>

        <div
          className="grid gap-3 p-4 pb-[190px]"
          style={{ gridTemplateColumns: view.mode === "list" ? "1fr" : `repeat(auto-fill, minmax(${Math.round(1100 / view.cols)}px, 1fr))` }}
        >
          {(tab === "liked" ? clips.slice(0, 2) : clips).map((c) => (
            <WaveCard key={c.id} {...c} list={view.mode === "list"} />
          ))}
        </div>
      </main>

      {/* The dock: the compact recipe — radius 20 on a 5% white fill, 12px pad. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3">
        <div
          className="pointer-events-auto flex w-full max-w-[760px] items-stretch gap-3 rounded-[20px] p-3"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid var(--vg-border-subtle)", backdropFilter: "blur(11px)" }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <textarea
              value={s.prompt}
              onChange={(e) => s.setPrompt(e.target.value)}
              rows={2}
              placeholder="متنی که می‌خواهی گفته شود را بنویس."
              className="hide-scrollbar min-h-[44px] w-full resize-none bg-transparent text-[13.5px] leading-6 outline-none"
              style={{ color: "var(--vg-text)" }}
            />
            {/* Menus portal out through PopoverChip. This row scrolls
                horizontally, and an overflow container clips both axes — an
                in-tree menu would be cut to the row's 32px. */}
            <div className="hide-scrollbar flex items-center gap-1.5 overflow-x-auto">
              <ModelChip
                families={families}
                family={s.family}
                variant={s.variant}
                onPickFamily={s.setFamily}
                onPickVariant={s.setVariant}
                className={`${CHIP_CLASS} gap-1.5`}
                style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
              />
              {s.chips.map((c) =>
                c.kind === "toggle" ? (
                  <button
                    key={c.key}
                    onClick={() => s.set(c.key, !s.input[c.key])}
                    className={CHIP_CLASS}
                    style={{
                      background: s.input[c.key] ? "rgba(233,95,24,0.16)" : "var(--vg-surface-overlay)",
                      color: s.input[c.key] ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                    }}
                  >
                    {c.label}
                  </button>
                ) : (
                  <PopoverChip
                    key={c.key}
                    label={`${c.label}: ${valueLabel(c, s.input)}`}
                    value={String(s.input[c.key])}
                    range={rangeOf(c)}
                    options={
                      c.kind === "slider"
                        ? sliderSteps(c).map((v) => ({ value: (c.asString ? String(v) : v) as string | number, label: `${v}${c.unit ? ` ${c.unit}` : ""}` }))
                        : c.options.map((o) => ({ value: o.value as string | number, label: o.label }))
                    }
                    onPick={(v) => s.set(c.key, c.kind === "slider" && c.asString ? String(v) : v)}
                    className={CHIP_CLASS}
                    style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                  />
                ),
              )}
            </div>
          </div>

          {/* The voice preset card — the only part of their dial cluster that
              maps onto a control we actually have. */}
          {/* Opens the voice browser instead of being a <select> of 46 names.
              A voice is chosen by ear, and the catalog has always carried a
              free preview URL for each one. */}
          {voiceControl && (
            <button
              onClick={() => setPickVoice(true)}
              className="hidden w-[168px] shrink-0 flex-col justify-center rounded-xl px-3 py-2 text-start transition-colors hover:bg-white/[0.04] sm:flex"
              style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
            >
              <span className="text-[10.5px]" style={{ color: "var(--vg-text-muted)" }}>
                صدا
              </span>
              <bdi className="vg-numeric block truncate text-[13px] tracking-[0.1em]" style={{ color: "var(--vg-text)" }}>
                {voice?.name ?? "انتخاب کن"}
              </bdi>
              <span className="mt-1 flex h-4 items-center gap-[1.5px]" aria-hidden>
                {bars(voice?.id ?? "x", 26).map((v, i) => (
                  <span key={i} className="flex-1 rounded-full" style={{ height: `${Math.round(v * 100)}%`, background: "var(--vg-primary-dim)" }} />
                ))}
              </span>
            </button>
          )}

          <button
            disabled={!s.ready}
            onClick={() => onGenerate(s.family, s.variant, s.prompt.trim(), s.input)}
            className="flex w-[124px] shrink-0 flex-col items-center justify-center gap-1 rounded-xl text-[14px] font-bold transition-opacity disabled:opacity-35"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <span className="flex items-center gap-1.5">
              <Sparkle size={14} weight="fill" />
              بساز
            </span>
            <span className="flex items-center gap-1 text-[11.5px] font-semibold opacity-90">
              <CoinMark size={11} />
              <span className="vg-numeric">{s.price === null ? "—" : n(s.price)}</span>
            </span>
          </button>
        </div>
      </div>

      {pickVoice && voiceControl && (
        <VoicePicker
          selectedId={voiceId}
          onPick={(v) => s.set(voiceControl.key, v.id)}
          onClose={() => setPickVoice(false)}
        />
      )}
    </div>
  );
}
