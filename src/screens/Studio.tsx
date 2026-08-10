import { useEffect, useMemo, useState } from "react";
import { FolderSimple, BookOpen } from "@phosphor-icons/react";
import { motion } from "framer-motion";
import { FAMILIES, type Family, type ModelKind, type Variant } from "../data/models";
import { VendorMark } from "../components/VendorMark";
import type { InputMap } from "../components/controls";
import { FormPanel } from "../components/FormPanel";
import { ViewControls, useViewMode } from "../components/ViewControls";
import { type Generation } from "../lib/gallery";
import { isVideoUrl } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import { riseItem, riseParent } from "../lib/motion";

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

const KIND_EMPTY: Record<ModelKind, string> = {
  image: "مدل را انتخاب کن، صحنه‌ات را بنویس، و دکمه را بزن. هزینه‌ی هر تصویر روی دکمه نوشته شده — قبل از اینکه بزنی.",
  video: "مدل را انتخاب کن، صحنه‌ات را بنویس، و دکمه را بزن. هزینه‌ی هر ویدیو روی دکمه نوشته شده — قبل از اینکه بزنی.",
  audio: "صدا را انتخاب کن، متنت را بنویس، و دکمه را بزن. هزینه روی دکمه نوشته شده — قبل از اینکه بزنی.",
};

const STEPS = [
  { title: "مدل را انتخاب کن", body: "هر مدل نقطه‌ی قوت خودش را دارد. کارت بالای پنل نشان می‌دهد الان کدام فعال است." },
  { title: "توصیف کن", body: "هرچه دقیق‌تر بنویسی خروجی نزدیک‌تر است. نور، لنز، حرکت دوربین." },
  { title: "بساز", body: "قیمت روی دکمه است. سکه فقط وقتی کم می‌شود که خروجی ساخته شود." },
];

function OutputCard({ gen }: { gen: Generation }) {
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
      {url && !failed && (
        isVideoUrl(url) ? (
          <video src={url} muted loop playsInline className="absolute inset-0 size-full object-cover" />
        ) : (
          <img src={url} alt={gen.prompt} onError={onError} className="absolute inset-0 size-full object-cover" />
        )
      )}

      {running && (
        // The one perpetual animation the system allows. A generation is money
        // already spent, so it gets a real determinate bar, not a spinner.
        <div className="absolute inset-0 grid place-items-center" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="w-2/3">
            <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.12)" }}>
              <motion.div
                className="h-full"
                style={{ background: "var(--vg-primary)" }}
                animate={{ width: ["8%", "72%"] }}
                transition={{ duration: 18, ease: "easeOut" }}
              />
            </div>
            <p className="mt-2 text-center text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
              در حال ساخت…
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
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
  onOpen: (g: Generation) => void;
}) {
  const families = useMemo(() => FAMILIES.filter((f) => f.kind === kind), [kind]);
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
      <FormPanel families={families} onGenerate={onGenerate} />

      <main
        className="min-w-0 flex-1 px-4 pb-16 pt-5 md:px-8"
        style={{ borderInlineStart: "1px solid var(--vg-border-subtle)" }}
      >
        {/* Their canvas heads with two pill tabs on the leading side and the
            view controls on the trailing side — 120x32 at radius 8. The row is
            always present; it does not appear only once there is history. */}
        {mine.length > 0 && (
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              {([
                { k: "history" as const, Icon: FolderSimple, label: "تاریخچه" },
                { k: "how" as const, Icon: BookOpen, label: "چطور کار می‌کند" },
              ]).map(({ k, Icon, label }) => (
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
            {canvasTab === "history" && (
              <ViewControls mode={view.mode} density={view.density} onMode={view.setMode} onDensity={view.setDensity} />
            )}
          </div>
        )}

        {/* "How it works" stays reachable once there is history, because the
            person who needs it most is the one whose first two came out wrong. */}
        {mine.length === 0 || canvasTab === "how" ? (
          <div className="mx-auto max-w-[720px] py-8">
            {/* The reference opens on a three-step explainer rather than an empty
                grid: on first run there is nothing to show, and "how this works"
                is the only useful thing the space can hold. */}
            <h1
              className="text-[34px] font-extrabold leading-[1.15]"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              با یک جمله بساز
            </h1>
            <p className="mt-2 max-w-[52ch] text-[13.5px] leading-7" style={{ color: "var(--vg-text-muted)" }}>
              {KIND_EMPTY[kind]}
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {STEPS.map((s, i) => (
                <div key={s.title}>
                  <div
                    className="mb-3 grid aspect-[4/3] place-items-center rounded-xl"
                    style={{ background: "var(--vg-surface)", border: "1px dashed var(--vg-border)" }}
                  >
                    <span className="vg-numeric text-[26px] font-extrabold" style={{ color: "var(--vg-border-strong)" }}>
                      {i + 1}
                    </span>
                  </div>
                  <p className="text-[13.5px] font-bold" style={{ color: "var(--vg-text)" }}>
                    {s.title}
                  </p>
                  <p className="mt-1 text-[12px] leading-5" style={{ color: "var(--vg-text-muted)" }}>
                    {s.body}
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
                      {g.outputUrl &&
                        (isVideoUrl(g.outputUrl) ? (
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
                        {[`${g.w}×${g.h}`, g.durationMs ? `${Math.round(g.durationMs / 1000)}s` : null]
                          .filter(Boolean)
                          .map((t) => (
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
                        {new Intl.DateTimeFormat("fa-IR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(g.createdAt)}
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
