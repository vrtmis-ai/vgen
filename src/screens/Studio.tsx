import { useEffect, useMemo, useState } from "react";
import { FolderSimple, BookOpen, SlidersHorizontal, TextAa, Sparkle } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { type Family, type ModelKind, type Variant } from "../data/models";
import { useCatalogFamilies } from "../features/catalog/CatalogProvider";
import { VendorMark } from "../components/VendorMark";
import type { InputMap, RefMap } from "../components/controls";
import { FormPanel } from "../components/FormPanel";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { type Generation } from "../lib/gallery";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import { riseItem, riseParent } from "../lib/motion";
import { useI18n, type TKey } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The canvas.

   One surface per modality, with the prompt bar pinned to the top of it and the
   user's own output filling everything below. The reference reaches this shape
   by carrying the model in a URL parameter over a single canvas rather than
   giving each model a page; the effect is that the prompt survives a model
   change, so trying one idea against two engines costs nothing.

   The 800px cap on the bar is the reference's own number. It stops being a cap
   below `md`, where the bar spans the column.
   --------------------------------------------------------------------------- */

/* Through `useI18n` rather than inlined here. These were Persian string
   literals, so the whole explainer stayed Persian in English mode — on the one
   surface whose job is explaining the product to somebody who has not used it. */
const KIND_EMPTY: Record<ModelKind, TKey> = {
  image: "st_how_image",
  video: "st_how_video",
  audio: "st_how_audio",
};

/**
 * The three steps, and the slot each one's picture will land in.
 *
 * `art` is deliberately absent for now: the reference illustrates every step
 * with a shot of its own product, and borrowing stock photography to stand in
 * would claim it is ours. Until real screenshots exist the icon carries it, and
 * filling `art` is the whole change.
 */
const STEPS: { title: TKey; body: TKey; Icon: typeof SlidersHorizontal; art?: string }[] = [
  { title: "st_step1_title", body: "st_step1_body", Icon: SlidersHorizontal },
  { title: "st_step2_title", body: "st_step2_body", Icon: TextAa },
  { title: "st_step3_title", body: "st_step3_body", Icon: Sparkle },
];

function OutputCard({ gen }: { gen: Generation }) {
  const { t, n } = useI18n();
  const percent = Math.round(gen.progress ?? 0);
  const [failed, onError] = useImageFallback();
  const url = gen.outputUrl;
  const running = gen.status === "running";
  return (
    <motion.div
      variants={riseItem}
      className="relative overflow-hidden rounded-[20px]"
      style={{
        aspectRatio: `${gen.w} / ${gen.h}`,
        background: failed || !url ? gen.grad : "var(--vg-surface)",
        border: "1px solid var(--vg-border-subtle)",
      }}
    >
      {url &&
        !failed &&
        (isVideoUrl(url) ? (
          <video src={url} muted loop playsInline className="absolute inset-0 size-full object-cover" />
        ) : (
          <img src={url} alt={gen.prompt} onError={onError} className="absolute inset-0 size-full object-cover" />
        ))}

      {running && (
        /* A real determinate bar, driven by the job's own progress rather than
           a fixed 18-second animation that finished whenever it felt like it.
           A generation is money already spent, so it gets a number. */
        <div className="absolute inset-0 grid place-items-center" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="w-2/3">
            {/* A progressbar, not a div that happens to be N% wide.
                The percentage was in the caption and nowhere else, so a screen
                reader got a stray number with no role, no range and no update as
                the job advanced — on the one screen where the whole point is
                telling somebody how far along the thing they paid for is. */}
            <div
              role="progressbar"
              aria-label={t("r_making")}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuetext={`${n(percent)}٪`}
              className="h-1 w-full overflow-hidden rounded-full"
              style={{ background: "rgba(255,255,255,0.12)" }}
            >
              <div
                className="h-full transition-[width] duration-200 ease-out"
                style={{ width: `${percent}%`, background: "var(--vg-primary)" }}
              />
            </div>
            {/* aria-hidden: the bar above already carries the figure, and a
                screen reader announcing both says it twice every tick. */}
            <p aria-hidden className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
              {t("r_making")}… <span className="vg-numeric">{n(percent)}٪</span>
            </p>
          </div>
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-2.5"
        style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72), transparent)" }}
      >
        <span className="truncate text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          {gen.name}
        </span>
        <span className="vg-numeric shrink-0 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
          {gen.w}×{gen.h}
        </span>
      </div>
    </motion.div>
  );
}

export default function Studio({
  kind,
  gens,
  onGenerate,
  onOpen,
}: {
  kind: ModelKind;
  gens: Generation[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap, refs: RefMap) => void;
  onOpen: (g: Generation) => void;
}) {
  const { t } = useI18n();
  const catalogFamilies = useCatalogFamilies();
  const families = useMemo(() => catalogFamilies.filter((f) => f.kind === kind), [catalogFamilies, kind]);
  const [family, setFamily] = useState<Family>(() => families[0]!);
  const view = useViewMode("video", { mode: "grid", density: 1 });
  const [canvasTab, setCanvasTab] = useState<"history" | "how">("history");

  // Switching modality changes the whole catalog, so the held family may not
  // belong to it any more — keep the bar pointing at something real.
  useEffect(() => {
    if (!families.some((f) => f.id === family.id)) setFamily(families[0]!);
  }, [families, family.id]);

  const mine = gens.filter((g) => g.kind === kind);

  return (
    // The panel is a flex sibling of the canvas rather than a fixed overlay, so
    // it can simply stack above the canvas below `md` with no second layout.
    <div className="flex flex-col md:flex-row md:items-start">
      {/* See StudioImage. The visible heading below belongs to the empty state
          only, so once there is history this page had no h1 at all. */}
      <h1 className="sr-only">{kind === "video" ? "ساخت ویدیو" : "ساخت"}</h1>
      <FormPanel families={families} onGenerate={onGenerate} />

      <main
        // @container so the header's view controls size against this canvas
        // rather than the viewport — see ViewControls and StudioAudio.
        className="@container min-w-0 flex-1 px-4 pb-16 pt-5 md:px-8"
        style={{ borderInlineStart: "1px solid var(--vg-border-subtle)" }}
      >
        {/* Their canvas heads with two pill tabs on the leading side and the
            view controls on the trailing side — 120x32 at radius 8. The row is
            always present; it does not appear only once there is history. */}
        {/* Always, not once there is history.
            The tabs were gated on `mine.length > 0`, so a first-time visitor —
            the one person who needs "how it works" — had no way to reach it, and
            the canvas opened with no chrome at all. The reference keeps this row
            up permanently for the same reason. */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1">
            {[
              { k: "history" as const, Icon: FolderSimple, label: "تاریخچه" },
              { k: "how" as const, Icon: BookOpen, label: "چطور کار می‌کند" },
            ].map(({ k, Icon, label }) => (
              <button
                key={k}
                onClick={() => setCanvasTab(k)}
                aria-pressed={canvasTab === k}
                className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
                style={{
                  background: canvasTab === k ? "var(--vg-surface-overlay)" : "transparent",
                  color: canvasTab === k ? "var(--vg-text)" : "var(--vg-text-muted)",
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
          {/* Video gets the list as well as the size control. There are few
                enough clips that reading which prompt produced which is a real
                way to look at them — unlike the image wall, forty frames you
                scan. Hidden on the explainer, which has nothing to lay out. */}
          {canvasTab === "history" && mine.length > 0 && (
            <ViewControls mode={view.mode} density={view.density} onMode={view.setMode} onDensity={view.setDensity} />
          )}
        </div>

        {/* "How it works" stays reachable once there is history, because the
            person who needs it most is the one whose first two came out wrong. */}
        {mine.length === 0 || canvasTab === "how" ? (
          <div className="mx-auto max-w-[720px] py-8">
            {/* The reference opens on a three-step explainer rather than an empty
                grid: on first run there is nothing to show, and "how this works"
                is the only useful thing the space can hold. */}
            {/* h2, not h1: the sr-only page title above owns level one, and two
                h1s on a page is the same orientation problem as none. */}
            {/* Latin ghost label over the heading, the same device the image
                studio uses. The reference buys presence with uppercase; Persian
                has none, and this is what the design system added as its answer.
                Latin by contract, hence lang="en". */}
            <span className="t-ghost block" lang="en">
              {t("st_video_label")}
            </span>
            <h2 className="t-display mt-2 text-balance">{t("st_empty_title")}</h2>
            <p className="t-caption mt-2 max-w-[52ch] text-pretty" style={{ color: "var(--vg-text-muted)" }}>
              {t(KIND_EMPTY[kind])}
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {STEPS.map((step) => (
                <div key={step.title}>
                  {/* An illustration slot, not a number.
                      The reference puts a picture of the step here; ours held a
                      big grey numeral, which was the heaviest thing on the canvas
                      and said nothing the reading order does not already say.

                      `art` is the field a real screenshot lands in. Until one
                      exists the slot carries a brand wash and the step's own
                      icon — the same `cover ?? grad` fallback every model card in
                      this codebase already uses, rather than stock photography
                      standing in for our product. */}
                  <div
                    className="mb-3 grid aspect-[4/3] place-items-center overflow-hidden rounded-xl"
                    style={{
                      background: step.art ? undefined : "linear-gradient(135deg, var(--vg-accent-a20), var(--vg-surface-overlay) 70%)",
                      border: "1px solid var(--vg-border-subtle)",
                    }}
                  >
                    {step.art ? (
                      <img src={step.art} alt="" className="size-full object-cover" />
                    ) : (
                      <step.Icon size={26} weight="light" style={{ color: "var(--vg-text-muted)" }} />
                    )}
                  </div>
                  <p className="t-title" style={{ color: "var(--vg-text)" }}>
                    {t(step.title)}
                  </p>
                  <p className="t-caption mt-1" style={{ color: "var(--vg-text-muted)" }}>
                    {t(step.body)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {view.mode === "grid" ? (
              <motion.div
                variants={riseParent}
                initial="hidden"
                animate="show"
                className="mt-4 grid gap-3"
                style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${Math.round(1300 / view.cols)}px, 1fr))` }}
              >
                {mine.map((g) => (
                  <button key={g.id} onClick={() => onOpen(g)} className="text-start">
                    <OutputCard gen={g} />
                  </button>
                ))}
              </motion.div>
            ) : (
              /* Their list row is not a compact strip — it is the media at full
                 size with a 240px metadata column beside it. One generation per
                 row, the output dominant. A thumbnail-and-truncated-prompt row
                 is a denser grid, which is the one thing a list should not be. */
              <div className="mt-4 flex flex-col gap-6">
                {mine.map((g) => (
                  <div key={g.id} className="flex flex-col gap-3 lg:flex-row lg:items-start">
                    <button
                      onClick={() => onOpen(g)}
                      className="relative min-w-0 flex-1 overflow-hidden rounded-2xl"
                      style={{ aspectRatio: `${g.w} / ${g.h}`, background: g.grad, maxHeight: "70dvh" }}
                      aria-label={`باز کردن — ${g.prompt.trim() ? g.prompt.trim().slice(0, 60) : g.name}`}
                    >
                      {/* `g.kind`, not the file extension. An output URL is
                          signed and ends in a query string, so `.mp4$` never
                          matches one and every clip was handed to an `<img>`. */}
                      {g.outputUrl &&
                        (g.kind === "video" ? (
                          <video src={g.outputUrl} muted loop playsInline className="absolute inset-0 size-full object-cover" />
                        ) : (
                          <img src={g.outputUrl} alt="" className="absolute inset-0 size-full object-cover" />
                        ))}
                      {g.status === "running" && (
                        <span className="absolute inset-0 grid place-items-center" style={{ background: "rgba(0,0,0,0.45)" }}>
                          <span className="text-[12px]" style={{ color: "var(--vg-text-secondary)" }}>
                            در حال ساخت…
                          </span>
                        </span>
                      )}
                    </button>

                    <div className="flex w-full shrink-0 flex-col lg:w-[240px] lg:self-stretch">
                      <p className="flex items-center gap-1.5 text-[12.5px] font-bold" style={{ color: "var(--vg-text)" }}>
                        <VendorMark vendor={g.vendor} size={16} />
                        <bdi>{g.name}</bdi>
                      </p>
                      {/* The whole prompt. This column is the reason to leave
                          grid view; clamping it here would defeat the switch. */}
                      <p className="ltr mt-2 text-[12px] leading-5" style={{ color: "var(--vg-text-secondary)" }}>
                        {g.prompt || "—"}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {[`${g.w}×${g.h}`, g.durationMs ? `${Math.round(g.durationMs / 1000)}s` : null].filter(Boolean).map((t) => (
                          <span
                            key={t as string}
                            className="vg-numeric rounded-md px-1.5 py-0.5 text-[10.5px]"
                            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                      <p className="mt-auto pt-3 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                        {new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(
                          g.createdAt,
                        )}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
