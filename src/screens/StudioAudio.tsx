import { useMemo, useRef, useState } from "react";
import { Heart, Sparkle, Play, PencilSimple, CaretLeft, Plus, Minus } from "@phosphor-icons/react";
import { FAMILIES, type Family, type Variant } from "../data/models";
import type { InputMap } from "../components/controls";
import { useCreateState, valueLabel } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { VOICES } from "../data/voices";
import { VoicePicker } from "../components/VoicePicker";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { CoinMark } from "../components/chrome";
import { Card, PanelShell, PanelTabs } from "../components/FormPanel";
import { ModelPicker } from "../components/ModelPicker";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The audio studio.

   This screen was built twice, and the first version is worth recording because
   the mistake is easy to repeat. It copied an /audio capture showing a 48px icon
   rail and a floating dock — and by the time it shipped, that page no longer
   existed. Re-measuring found the surface rebuilt around the same 342px left
   column as video: underline tabs, a stack of cards, Generate at the foot.
   Copying a screenshot rather than the product is how a rebuild goes stale
   before it lands.

   What stays specific to audio is what the content forces. A speech result has
   no thumbnail, so the canvas card is a waveform with the script above it and
   the voice name in wide monospace — a grid built for pictures has nothing to
   put in the picture. The panel's cover slot holds the VOICE rather than a
   preset, because that is the choice this modality actually opens with, and it
   plays: `voicePreviewUrl` gives every voice a free sample.

   Text-to-speech is all we sell. Their Voice Change and Translate tabs are
   rendered disabled rather than dropped, so the gap stays visible to us.
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
  const [pickModel, setPickModel] = useState(false);
  const [batch, setBatch] = useState(1);
  const modelRow = useRef<HTMLDivElement>(null);
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
    /* Panel + canvas, not a bottom dock.
       Their audio page was rebuilt since the earlier capture: it now runs the
       same 342px left column as video — underline tabs, a stack of cards, the
       Generate button at the foot — rather than the floating dock and icon rail
       it used to have. Copying the old shape would leave us matching a
       screenshot instead of the product. */
    <div className="flex flex-col md:flex-row md:items-start">
      <PanelShell>
        {/* We only sell text-to-speech. The other two are theirs, shown
            disabled rather than omitted so the gap stays visible to us too. */}
        <PanelTabs
          tabs={[
            { key: "tts", label: "متن به گفتار" },
            { key: "change", label: "تغییر صدا", disabled: true },
            { key: "translate", label: "ترجمه", disabled: true },
          ]}
          active="tts"
          onPick={() => {}}
        />

        <div className="flex flex-col gap-2 p-3">
          {/* The voice card: 160px at radius 16, in the slot their cover card
              sits in. Big, and it plays — a voice is chosen by ear. */}
          <button
            onClick={() => setPickVoice(true)}
            className="relative h-[160px] overflow-hidden rounded-2xl text-start"
            style={{ background: "#000" }}
          >
            <span className="absolute inset-0" style={{ background: voiceGradient(voice?.id ?? "x") }} />
            <span
              className="absolute top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold backdrop-blur-md"
              style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
            >
              <PencilSimple size={11} weight="bold" />
              تغییر
            </span>
            <span className="absolute inset-x-3 bottom-3 flex items-center gap-2.5">
              <span
                className="grid size-9 shrink-0 place-items-center rounded-full backdrop-blur-md"
                style={{ background: "rgba(0,0,0,0.5)", color: "var(--vg-text)" }}
              >
                <Play size={14} weight="fill" />
              </span>
              <span className="min-w-0">
                <bdi className="vg-numeric block truncate text-[14px] tracking-[0.08em]" style={{ color: "var(--vg-text)" }}>
                  {voice?.name ?? "انتخاب صدا"}
                </bdi>
                <span className="block truncate text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
                  {voice?.note ?? "هنوز انتخاب نشده"}
                </span>
              </span>
            </span>
          </button>

          {/* "متن", not "پرامپت" — this is read aloud verbatim, and the helper
              says so. Their label and their helper, both earned. */}
          <Card className="p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                متن
              </span>
              <span className="vg-numeric text-[10.5px]" style={{ color: "var(--vg-text-muted)" }}>
                {n(s.prompt.length)}
              </span>
            </div>
            <textarea
              value={s.prompt}
              onChange={(e) => s.setPrompt(e.target.value)}
              rows={4}
              placeholder="دقیقاً همان چیزی که می‌خواهی خوانده شود."
              className="hide-scrollbar w-full resize-none bg-transparent text-[13px] leading-6 outline-none"
              style={{ color: "var(--vg-text)" }}
            />
            <p className="mt-1 text-[10.5px] leading-4" style={{ color: "var(--vg-text-muted)" }}>
              نقطه و ویرگول را بگذار — مکث و لحن را از روی نشانه‌گذاری می‌سازد.
            </p>
          </Card>

          <div ref={modelRow}>
            <Card>
              <button onClick={() => setPickModel((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2.5 text-start">
                <span className="flex-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                  مدل
                </span>
                <bdi className="truncate text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
                  {s.family.name} · {s.variant.label}
                </bdi>
                <CaretLeft size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
              </button>
            </Card>
          </div>
          {pickModel && (
            <ModelPicker
              anchor={modelRow.current}
              families={families}
              family={s.family}
              variant={s.variant}
              onPickFamily={s.setFamily}
              onPickVariant={s.setVariant}
              onClose={() => setPickModel(false)}
            />
          )}

          {/* Batch size, as theirs has. Speech is cheap enough to want four
              takes of one line and keep the best. */}
          <Card>
            <div className="flex items-center gap-2 px-3 py-2">
              <span className="flex-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                تعداد نسخه
              </span>
              <button
                onClick={() => setBatch((b) => Math.max(1, b - 1))}
                disabled={batch === 1}
                aria-label="کمتر"
                className="grid size-7 place-items-center rounded-lg disabled:opacity-30"
                style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
              >
                <Minus size={12} weight="bold" />
              </button>
              <span className="vg-numeric w-10 text-center text-[12.5px]" style={{ color: "var(--vg-text)" }}>
                {n(batch)}/{n(4)}
              </span>
              <button
                onClick={() => setBatch((b) => Math.min(4, b + 1))}
                disabled={batch === 4}
                aria-label="بیشتر"
                className="grid size-7 place-items-center rounded-lg disabled:opacity-30"
                style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
              >
                <Plus size={12} weight="bold" />
              </button>
            </div>
          </Card>

          {s.chips.length > 0 && (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-1 py-1.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                <CaretLeft size={12} weight="bold" className="transition-transform group-open:-rotate-90" />
                تنظیمات پیشرفته
              </summary>
              <div className="mt-1 flex flex-col gap-2">
                {s.chips.map((c) =>
                  c.kind === "slider" ? (
                    <Card key={c.key} className="px-3 py-2.5">
                      <div className="mb-1.5 flex items-baseline justify-between">
                        <span className="text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
                          {c.label}
                        </span>
                        <span className="vg-numeric text-[12px]" style={{ color: "var(--vg-primary-soft)" }}>
                          {String(s.input[c.key])}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={c.min}
                        max={c.max}
                        step={c.step}
                        value={Number(s.input[c.key])}
                        onChange={(e) => s.set(c.key, c.asString ? e.target.value : Number(e.target.value))}
                        className="w-full"
                        aria-label={c.label}
                      />
                    </Card>
                  ) : (
                    <Card key={c.key} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="flex-1 text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
                          {c.label}
                        </span>
                        <span className="text-[12px]" style={{ color: "var(--vg-text)" }}>
                          {valueLabel(c, s.input)}
                        </span>
                      </div>
                    </Card>
                  ),
                )}
              </div>
            </details>
          )}
        </div>

        <div className="sticky bottom-0 mt-auto p-3" style={{ background: "var(--vg-deep)" }}>
          <button
            disabled={!s.ready}
            onClick={() => onGenerate(s.family, s.variant, s.prompt.trim(), s.input)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition-opacity disabled:opacity-35"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <Sparkle size={15} weight="fill" />
            بساز
            <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
              <CoinMark size={12} />
              <span className="vg-numeric">{s.price === null ? "—" : n(s.price * batch)}</span>
            </span>
          </button>
        </div>
      </PanelShell>

      <main className="min-w-0 flex-1" style={{ borderInlineStart: "1px solid var(--vg-border-subtle)" }}>
        <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          {([["all", "همه"], ["liked", "پسندیده"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              aria-pressed={tab === k}
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
          className="grid gap-3 p-4 pb-16"
          style={{ gridTemplateColumns: view.mode === "list" ? "1fr" : `repeat(auto-fill, minmax(${Math.round(1100 / view.cols)}px, 1fr))` }}
        >
          {(tab === "liked" ? clips.slice(0, 2) : clips).map((c) => (
            <WaveCard key={c.id} {...c} list={view.mode === "list"} />
          ))}
        </div>
      </main>

      {pickVoice && voiceControl && (
        <VoicePicker selectedId={voiceId} onPick={(v) => s.set(voiceControl.key, v.id)} onClose={() => setPickVoice(false)} />
      )}
    </div>
  );
}

/** A calm wash per voice, so the card is not an empty black rectangle before
 *  there is any artwork to put in it. Deterministic from the id. */
function voiceGradient(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const a = h % 360;
  return `linear-gradient(140deg, hsl(${a} 45% 22%), hsl(${(a + 48) % 360} 40% 12%))`;
}

