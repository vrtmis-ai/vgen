import { useState } from "react";
import { motion } from "framer-motion";
import { ImagesSquare, CircleNotch } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import type { ModelKind } from "../data/models";
import { useI18n } from "../lib/i18n";

function GenCard({ g, i, onOpen }: { g: Generation; i: number; onOpen: () => void }) {
  const { t } = useI18n();
  const running = g.status === "running";
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
      onClick={onOpen}
      className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line text-start active:scale-[0.98] transition-transform"
    >
      <div className="relative w-full" style={{ aspectRatio: `${g.w}/${g.h}`, background: g.grad }}>
        {running && <div className="shimmer absolute inset-0 bg-card/60" />}
        <div className="scrim-media" />
        <div className="absolute start-2 top-2">
          {running ? (
            <span className="flex items-center gap-1 rounded-full bg-bg/65 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">
              <CircleNotch size={11} className="animate-spin" />
              {t("gal_making")}
            </span>
          ) : (
            <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">{t(g.kind === "video" ? "kind_video" : g.kind === "audio" ? "kind_audio" : "kind_image")}</span>
          )}
        </div>
        <div className="absolute inset-x-2.5 bottom-2.5">
          <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">{g.name}</span>
          {g.prompt && <p className="ltr mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-white/85">{g.prompt}</p>}
        </div>
      </div>
    </motion.button>
  );
}

type Filter = "all" | ModelKind | "running";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "video", label: "ویدیو" },
  { key: "image", label: "تصویر" },
  { key: "audio", label: "صدا" },
  { key: "running", label: "در حال ساخت" },
];

export default function Gallery({
  gens,
  onOpen,
  onBrowse,
}: {
  gens: Generation[];
  onOpen: (g: Generation) => void;
  onBrowse: () => void;
}) {
  const { t, n } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");

  const count = (f: Filter) =>
    f === "all" ? gens.length : f === "running" ? gens.filter((g) => g.status === "running").length : gens.filter((g) => g.kind === f).length;
  const shown = gens.filter((g) => (filter === "all" ? true : filter === "running" ? g.status === "running" : g.kind === filter));

  return (
    /* Rebuilt for the top-bar shell. Like Community, this printed its own title
       row with a CreditPill in it — a second balance directly under the one in
       the chrome, left over from when it was a tab in a 480px column. */
    <div className="relative z-10 mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-16 pt-5 md:px-8">
      <h1 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        {t("gal_title")}
      </h1>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
        هرچه ساخته‌ای اینجاست. هیچ‌کدام تا وقتی خودت نخواهی عمومی نمی‌شود.
      </p>

      {/* A filter row only earns its space once there is something to filter. */}
      {gens.length > 0 && (
        <div className="hide-scrollbar -mx-4 my-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
          {FILTERS.filter((f) => count(f.key) > 0 || f.key === "all").map((f) => {
            const on = f.key === filter;
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={on}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
                style={{
                  background: on ? "rgba(233,95,24,0.14)" : "var(--vg-surface)",
                  color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                  border: "1px solid var(--vg-border-subtle)",
                }}
              >
                {f.label}
                <span className="vg-numeric text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                  {n(count(f.key))}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {gens.length === 0 ? (
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-ink3 opacity-50">
            <ImagesSquare size={44} />
          </div>
          <div className="text-[14px] font-medium">{t("gal_empty_title")}</div>
          <div className="text-[12.5px] text-ink3">{t("gal_empty_sub")}</div>
          <button onClick={onBrowse} className="btn-accent mt-1 rounded-full px-5 py-2.5 text-[13px] font-semibold">
            {t("gal_browse")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="py-16 text-center text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
          با این فیلتر چیزی نیست.
        </p>
      ) : (
        /* Widens past two phone columns — it was fixed at two on a 1440px page. */
        <div className="[column-fill:_balance] columns-2 gap-3 md:columns-3 xl:columns-4">
          {shown.map((g, i) => (
            <GenCard key={g.id} g={g} i={i} onOpen={() => onOpen(g)} />
          ))}
        </div>
      )}
    </div>
  );
}
