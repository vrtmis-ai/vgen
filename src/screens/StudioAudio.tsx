import { useRef, useState } from "react";
import { Sparkle, Play, PencilSimple, CaretLeft, FolderSimple, Lock, SpeakerHigh, MusicNotes, Waveform } from "@phosphor-icons/react";
import { type Family, type Variant } from "../data/models";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";
import { ControlField, type InputMap } from "../components/controls";
import { useCreateState } from "../lib/useCreateState";
import { type Generation } from "../lib/gallery";
import { usePublishedContent } from "../features/content/ContentProvider";
import { VoicePicker } from "../components/VoicePicker";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { CoinMark } from "../components/chrome";
import { Panel, PanelHead, PanelShell, PanelTabs, Section } from "../components/FormPanel";
import { ModelPicker } from "../components/ModelPicker";
import { useIgnition } from "../components/Ignition";
import { FailedVeil } from "../components/GenerationVeils";
import { useRevealArrival } from "../lib/useRevealArrival";
import { labelDir, promptDir } from "../lib/format";
import { useI18n, type TKey } from "../lib/i18n";
import { useSession } from "../runtime/providers/SessionProvider";
import { useAppServices } from "../runtime/AppServices";
import { useAccess } from "../lib/access";
import { WaveCard, clipsOf, downloadClip, useClipPlayer, type Clip } from "../components/AudioClip";

/* ---------------------------------------------------------------------------
   The audio studio.

   This screen was built twice, and the first version is worth recording because
   the mistake is easy to repeat. It copied an /audio capture showing a 48px icon
   rail and a floating dock — and by the time it shipped, that page no longer
   existed. Re-measuring found the surface rebuilt around the same 342px left
   column as video: underline tabs, a stack of cards, Generate at the foot.
   Copying a screenshot rather than the product is how a rebuild goes stale
   before it lands.

   What stays specific to audio is what the content forces. A result has no
   thumbnail, so the canvas card is a waveform with the text above it and the
   model in wide monospace — a grid built for pictures has nothing to put in the
   picture. For speech the panel's cover slot holds the VOICE, because that is
   the choice speech opens with, and it plays: `voicePreviewUrl` gives every
   ElevenLabs voice a free sample. Music and effects open on the model instead.

   Three tabs, one per feature code: speech, music, sound effects. The tabs
   read the catalogue, so a section with no model in it does not render — the
   same rule the navigation's columns follow.
   --------------------------------------------------------------------------- */

type SectionCode = "speech_generate" | "music_generate" | "sound_generate";

/** What the text box is, per section. Read aloud, described, or described. */
const SECTIONS: {
  code: SectionCode;
  tab: TKey;
  field: string;
  placeholder: string;
  hint: string;
  empty: string;
}[] = [
  {
    code: "speech_generate",
    tab: "menu_speech_generate",
    // "متن", not "پرامپت" — this is read aloud verbatim, and the hint says so.
    field: "متن",
    placeholder: "دقیقاً همان چیزی که می‌خواهی خوانده شود.",
    hint: "نقطه و ویرگول را بگذار — مکث و لحن را از روی نشانه‌گذاری می‌سازد.",
    empty: "هنوز صدایی نساخته‌ای. متنت را بنویس و صدا را انتخاب کن.",
  },
  {
    code: "music_generate",
    tab: "menu_music_generate",
    field: "توصیف آهنگ",
    placeholder: "مثلاً: یک آهنگ پاپ شاد درباره‌ی تابستان، با صدای زن",
    hint: "شعر را خود مدل از روی توصیف می‌نویسد. هر ساخت دو نسخه‌ی متفاوت می‌دهد.",
    empty: "هنوز آهنگی نساخته‌ای. بگو چه حال‌وهوایی می‌خواهی.",
  },
  {
    code: "sound_generate",
    tab: "menu_sound_generate",
    field: "توصیف صدا",
    placeholder: "مثلاً: باران روی سقف حلبی",
    hint: "کوتاه و مشخص بنویس. هر ساخت دو نسخه‌ی متفاوت می‌دهد.",
    empty: "هنوز افکتی نساخته‌ای. صدایی را که لازم داری توصیف کن.",
  },
];

const carries = (family: Family, code: SectionCode) => family.variants.some((variant) => variant.featureCode === code);

export default function StudioAudio({
  gens,
  onGenerate,
  onRemove,
}: {
  gens: Generation[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
  /** Offered on a refused generation only, as in کارهای من. */
  onRemove: (g: Generation) => void;
}) {
  const { t, n } = useI18n();
  const services = useAppServices();
  const catalogFamilies = useCatalogFamilies();
  const audioFamilies = catalogFamilies.filter((f) => f.kind === "audio");
  // A section the catalogue has no model for does not get a tab.
  const sections = SECTIONS.filter((section) => audioFamilies.some((family) => carries(family, section.code)));
  const [sectionCode, setSectionCode] = useState<SectionCode>("speech_generate");
  const section = sections.find((candidate) => candidate.code === sectionCode) ?? sections[0] ?? SECTIONS[0]!;
  const families = audioFamilies.filter((family) => carries(family, section.code));

  const s = useCreateState(families);
  const access = useAccess();
  // See StudioImage: a visitor gets the studio and a sign-in button in place
  // of the one control that spends. The upgrade lock does not apply to them.
  const { user, signIn } = useSession();
  const visitor = user === null;
  const locked = !access.can(s.family.id);
  const need = locked ? access.needs(s.family.id) : null;
  const [pickVoice, setPickVoice] = useState(false);
  const [pickModel, setPickModel] = useState(false);
  const modelRow = useRef<HTMLDivElement>(null);
  // See FormPanel: the field lights across «بساز», then the job is sent.
  const ignition = useIgnition();
  const player = useClipPlayer();
  // Their audio canvas opens in list: an audio result has no thumbnail, so the
  // row with its waveform is the more useful default.
  const view = useViewMode("audio", { mode: "list", density: 1 });

  // This section's work only: a song under the speech tab is noise.
  const mine = gens.filter((g) => g.kind === "audio" && families.some((family) => family.id === g.familyId));
  /* Running jobs stay out of the clip list and sit above it: a result is a
     waveform and a duration, and a job that has not finished has neither. */
  const running = mine.filter((g) => g.status === "running");
  /* `done`, not "not running". A refused job has no audio, and it was drawn as
     a clip anyway — a waveform, a play button and a made-up 00:12 — so a
     refusal looked like a result that would not play. Refusals get their own
     row now, with the reason, above the clips. */
  const refused = mine.filter((g) => g.status === "failed");
  // The press stays on this page, so bring the job it made into view.
  const reveal = useRevealArrival(mine[0]?.id);
  const clips: Clip[] = mine.filter((g) => g.status === "done").flatMap(clipsOf);

  const voiceControl = s.controls.find((c) => c.kind === "voice");
  const voiceId = voiceControl ? String(s.input[voiceControl.key]) : null;
  const voice = usePublishedContent().voices.find((v) => v.id === voiceId);
  // The voice has its own card; everything else is a setting in the stack.
  const settings = s.controls.filter((c) => c.kind !== "voice");
  const basic = settings.filter((c) => !("advanced" in c && c.advanced));
  const advanced = settings.filter((c) => "advanced" in c && c.advanced);
  const maxPrompt = s.variant.maxPrompt ?? s.family.maxPrompt ?? null;

  return (
    /* Panel + canvas, not a bottom dock.
       Their audio page was rebuilt since the earlier capture: it now runs the
       same 342px left column as video — underline tabs, a stack of cards, the
       Generate button at the foot — rather than the floating dock and icon rail
       it used to have. Copying the old shape would leave us matching a
       screenshot instead of the product. */
    <div className="flex flex-col md:flex-row md:items-start">
      {/* See StudioImage: the studios carry no visible page title, so without
          this the document has no h1 and a route change announces nothing. */}
      <h1 className="sr-only">ساخت صدا</h1>
      <PanelShell>
        {sections.length > 1 && (
          <PanelTabs
            tabs={sections.map((candidate) => ({ key: candidate.code, label: t(candidate.tab) }))}
            active={section.code}
            onPick={(code) => {
              // The clip playing belongs to the tab being left.
              player.stop();
              setSectionCode(code);
            }}
          />
        )}

        {/* One surface, as the video dock is — see `Panel` in FormPanel. This
            column was the last one still built from floating washes eight
            pixels apart, so going between the two studios changed the whole
            material of the panel for no reason the customer could see. */}
        <div className="p-2.5">
          <Panel>
            {voiceControl ? (
              <>
                {/* The voice is this panel's subject, so the head names it.

                    The subtitle is the voice's own note — its character — where
                    the video head shows the vendor. Same rule, different answer:
                    a voice is chosen by what it sounds like, and "ElevenLabs" is
                    already in the model row below, so repeating it here would
                    say nothing. */}
                <PanelHead
                  icon={<SpeakerHigh size={14} weight="fill" />}
                  title={voice?.name ?? "انتخاب صدا"}
                  sub={voice?.note ?? "هنوز انتخاب نشده"}
                />

                <Section>
                  {/* The voice card, full-bleed inside the panel. It opens the
                      picker, and needs a label of its own: "تغییر" alone does
                      not say what changes. */}
                  <button
                    onClick={() => setPickVoice(true)}
                    aria-label={voice ? `تغییر صدا — ${voice.name}` : "انتخاب صدا"}
                    className="relative block h-[132px] w-full overflow-hidden text-start"
                    // --vg-canvas (#090909), not #000. The only raw hex left in a
                    // screen and the only pure black in the app: it sat outside
                    // the token layer, so a change to the base surface would have
                    // skipped it, and against the near-black canvas it read as a hole.
                    style={{ background: "var(--vg-canvas)" }}
                  >
                    <span className="absolute inset-0" style={{ background: voiceGradient(voice?.id ?? "x") }} />
                    <span
                      className="absolute top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold backdrop-blur-md"
                      style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
                    >
                      <PencilSimple size={11} weight="bold" />
                      تغییر
                    </span>
                    <span
                      className="absolute bottom-3 grid size-9 place-items-center rounded-full backdrop-blur-md"
                      style={{ insetInlineStart: "0.75rem", background: "rgba(0,0,0,0.5)", color: "var(--vg-text)" }}
                    >
                      <Play size={14} weight="fill" />
                    </span>
                  </button>
                </Section>
              </>
            ) : (
              /* No voice to open on — Gemini names its voices in a list, and
                 music and effects have none — so the model is the subject. */
              <PanelHead
                icon={
                  section.code === "speech_generate" ? (
                    <SpeakerHigh size={14} weight="fill" />
                  ) : section.code === "music_generate" ? (
                    <MusicNotes size={14} weight="fill" />
                  ) : (
                    <Waveform size={14} weight="fill" />
                  )
                }
                title={s.family.name}
                sub={s.family.blurb}
              />
            )}

            <Section className="px-2.5 py-2">
              {/* The whole row flips, not just the caption: the count belongs on
                  the far side from the label, whichever side that is. */}
              <div className="mb-1 flex items-center justify-between" dir={labelDir(s.prompt)}>
                <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                  {section.field}
                </span>
                <span className="vg-numeric text-[10.5px]" style={{ color: "var(--vg-text-muted)" }}>
                  {maxPrompt === null ? n(s.prompt.length) : `${n(s.prompt.length)} / ${n(maxPrompt)}`}
                </span>
              </div>
              <textarea
                value={s.prompt}
                onChange={(e) => s.setPrompt(e.target.value)}
                rows={4}
                dir={promptDir(s.prompt)}
                maxLength={maxPrompt ?? undefined}
                placeholder={section.placeholder}
                aria-label={section.field}
                className="hide-scrollbar vg-field-inset resize-none bg-transparent text-[12.5px] leading-[1.7] outline-none"
                style={{ color: "var(--vg-text)" }}
              />
              <p className="mt-1 text-[10.5px] leading-4" style={{ color: "var(--vg-text-muted)" }}>
                {section.hint}
              </p>
            </Section>

            <div ref={modelRow}>
              <Section>
                <button onClick={() => setPickModel((v) => !v)} className="flex w-full items-center gap-2 px-2.5 py-2.5 text-start">
                  <span className="flex-1 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
                    مدل
                  </span>
                  <bdi className="truncate text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
                    {s.family.name} · {s.variant.label}
                  </bdi>
                  <CaretLeft size={13} weight="bold" style={{ color: "var(--vg-text-muted)" }} />
                </button>
              </Section>
            </div>

            {/* The same field the model page renders, so a setting behaves the
                same on both. The advanced ones used to be listed here as
                read-only text — ElevenLabs Turbo's language could be seen and
                not changed. */}
            {basic.map((c) => (
              <Section key={c.key} className="px-2.5 py-2.5">
                <ControlField control={c} value={s.input[c.key]} onChange={s.set} />
              </Section>
            ))}

            {advanced.length > 0 && (
              <Section>
                <details className="group">
                  <summary
                    className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-2 text-[12px]"
                    style={{ color: "var(--vg-text-muted)" }}
                  >
                    <CaretLeft size={12} weight="bold" className="transition-transform group-open:-rotate-90" />
                    تنظیمات پیشرفته
                  </summary>
                  {/* Rows divided by hairlines, not cards inside a card — a
                      bordered box inside the panel's own box is the second edge
                      the panel exists to avoid. */}
                  <div className="flex flex-col">
                    {advanced.map((c) => (
                      <div key={c.key} className="px-2.5 py-2.5" style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
                        <ControlField control={c} value={s.input[c.key]} onChange={s.set} />
                      </div>
                    ))}
                  </div>
                </details>
              </Section>
            )}
          </Panel>
        </div>

        {/* A portal, so it lives outside the panel — `Panel` clips its corners
            and would clip a popover with them. */}
        {pickModel && (
          <ModelPicker
            anchor={modelRow.current}
            // Every audio model, not this tab's: somebody on the speech tab
            // looking for Suno found only the speech models and concluded it
            // was not offered. Picking one moves to the tab it belongs to.
            families={audioFamilies}
            family={s.family}
            variant={s.variant}
            onPickFamily={(family) => {
              const home = SECTIONS.find((candidate) => carries(family, candidate.code));
              if (home && home.code !== section.code) {
                player.stop();
                setSectionCode(home.code);
              }
              s.setFamily(family);
            }}
            onPickVariant={s.setVariant}
            onClose={() => setPickModel(false)}
          />
        )}

        <div
          className="sticky bottom-0 mt-auto p-2.5"
          style={{ background: "var(--vg-canvas)", borderBlockStart: "1px solid var(--vg-border-subtle)" }}
        >
          {/* See FormPanel. */}
          {locked && !visitor ? (
            <button
              onClick={access.onUpgrade}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-bold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
            >
              <Lock size={14} weight="fill" />
              {need ? (
                <>
                  ارتقا به <bdi>{need.name}</bdi>
                </>
              ) : (
                "ارتقای پلن"
              )}
            </button>
          ) : (
            <button
              disabled={!visitor && !s.ready}
              onClick={(event) =>
                visitor
                  ? signIn()
                  : ignition.ignite(event, () => {
                      reveal.arm();
                      onGenerate(s.family, s.variant, s.prompt.trim(), s.input);
                    })
              }
              aria-busy={ignition.igniting || undefined}
              className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded-[10px] text-[14px] font-bold transition-opacity disabled:opacity-35"
              style={{
                background: "var(--vg-primary)",
                color: ignition.igniting ? "var(--vg-text)" : "var(--vg-text-on-primary)",
                // A dark halo while it is light: the field sweeps in from the
                // pressed point, so for a moment the label sits half on lime.
                textShadow: ignition.igniting ? "0 0 6px rgb(0 0 0 / 0.7)" : undefined,
                // As in the video dock: the only filled accent in the column,
                // and a button that cannot be pressed does not glow.
                boxShadow: !visitor && !s.ready ? "none" : "var(--vg-glow-primary)",
              }}
            >
              {ignition.layer}
              <span className="relative flex items-center gap-2">
                <Sparkle size={15} weight="fill" />
                {visitor ? t("visitor_cta") : "بساز"}
                <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
                  <CoinMark size={12} />
                  <span className="vg-numeric">{s.price === null ? "—" : n(s.price)}</span>
                </span>
              </span>
            </button>
          )}
        </div>
      </PanelShell>

      {/* `@container`, and the history rows below size against it rather than
          against the viewport.
          The canvas sits beside a 342px panel, so at an 800px viewport it is
          only ~443px wide — but `sm:` had already fired at 640px and switched
          on a 200px voice column, a duration and four actions the canvas could
          not hold. The row's min-content went to 634px in a 443px box and
          pushed the page 208px sideways. A viewport breakpoint cannot see that;
          a container query can. */}
      <main className="@container min-w-0 flex-1" style={{ borderInlineStart: "1px solid var(--vg-border-subtle)" }}>
        <div className="flex items-center gap-1 px-4 py-2.5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          <span className="flex h-8 items-center gap-1.5 px-3 text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
            <FolderSimple size={13} />
            تاریخچه
          </span>
          <div className="ms-auto flex items-center gap-1.5">
            <ViewControls mode={view.mode} density={view.density} onMode={view.setMode} onDensity={view.setDensity} />
          </div>
        </div>

        <div
          className="grid gap-3 p-4 pb-16"
          style={{
            gridTemplateColumns: view.mode === "list" ? "1fr" : `repeat(auto-fill, minmax(${Math.round(1100 / view.cols)}px, 1fr))`,
          }}
        >
          {/* Running first. A job has no waveform yet, so it gets a bar rather
              than an empty card pretending to be a result. */}
          {running.map((g) => (
            <div
              key={g.id}
              ref={g.id === mine[0]?.id ? reveal.target : undefined}
              className="relative flex scroll-my-24 items-center gap-3 overflow-hidden rounded-xl p-4"
              style={{ border: "1px solid var(--vg-border-subtle)" }}
            >
              {/* The same moving field as a running card on the other two
                  canvases. No bar: nothing on the server reports progress,
                  and this one sat at 0% for the whole job. */}
              <div className="vg-gen-field" />
              <div className="relative min-w-0 flex-1">
                <p className="text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
                  {t("r_making")}…
                </p>
                <p className="mt-0.5 truncate text-[12.5px]" style={{ color: "var(--vg-text)" }}>
                  {g.prompt || g.name}
                </p>
              </div>
            </div>
          ))}
          {refused.map((g) => (
            <div
              key={g.id}
              ref={g.id === mine[0]?.id ? reveal.target : undefined}
              className="relative min-h-[104px] scroll-my-24 overflow-hidden rounded-xl"
              style={{ border: "1px solid var(--vg-border-subtle)" }}
            >
              <FailedVeil gen={g} onRemove={() => onRemove(g)} lines={2} />
            </div>
          ))}
          {clips.map((clip) => (
            <WaveCard
              key={clip.id}
              clip={clip}
              list={view.mode === "list"}
              audio={player.audioOf(clip)}
              onPlay={() => player.toggle(clip)}
              onDownload={clip.jobId && clip.url ? () => downloadClip(services.generation.downloadUrl, clip) : undefined}
            />
          ))}
          {/* An empty history says so. It used to be six invented clips with
              play buttons that did nothing, which read as results that would
              not play. */}
          {mine.length === 0 && (
            <p className="py-16 text-center text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
              {section.empty}
            </p>
          )}
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
