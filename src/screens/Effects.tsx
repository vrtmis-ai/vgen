import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { PRESETS, CATEGORY_LABEL, type PresetCategory } from "../data/presets";
import { published } from "../data/content";
import { getFamily } from "../data/models";

/* ---------------------------------------------------------------------------
   The effects index — the destination "همهٔ افکت‌ها" should always have had.

   Modelled on /collection/effects: a very large accent title, then the whole
   catalog as a centred wrap of name chips, then the grid. The chip cloud is
   doing two jobs at once and that is why it works — it is the filter, and it is
   also the fastest way to show that there are dozens of these without making
   anyone scroll to find out.
   --------------------------------------------------------------------------- */

const art = (seed: string) => `https://picsum.photos/seed/${seed}/480/640`;

export default function Effects({ onOpen }: { onOpen: (familyId: string, prompt?: string) => void }) {
  const all = useMemo(() => published(PRESETS), []);
  const [cat, setCat] = useState<PresetCategory | "all">("all");
  const [kind, setKind] = useState<"all" | "video" | "image">("all");

  const shown = all.filter((p) => (cat === "all" || p.category === cat) && (kind === "all" || p.kind === kind));

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-20 pt-8">
      <h1
        className="text-center text-[44px] font-extrabold leading-none md:text-[64px]"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-primary-soft)" }}
      >
        افکت‌های آماده
      </h1>
      <p className="mx-auto mt-3 max-w-[52ch] text-center text-[13.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
        هر افکت یک پرامپت کامل است که یک نفر قبلاً نوشته. انتخابش کن، سوژه‌ی خودت را اضافه کن، بساز.
      </p>

      {/* The name cloud. Every effect is one click from here, which is the
          whole point — a scroll is not an index. */}
      <div className="mx-auto mt-7 flex max-w-[900px] flex-wrap justify-center gap-1.5">
        {all.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpen(p.familyId, p.prompt)}
            className="rounded-md px-2 py-1 text-[12px] font-semibold transition-colors hover:bg-white/[0.08]"
            style={{ color: "var(--vg-text-secondary)" }}
          >
            {p.title}
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-1.5">
        {([["all", "همه"], ["video", "ویدیو"], ["image", "تصویر"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className="h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
            style={{
              background: kind === k ? "rgba(233,95,24,0.14)" : "var(--vg-surface)",
              color: kind === k ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
              border: "1px solid var(--vg-border-subtle)",
            }}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 h-5 w-px" style={{ background: "var(--vg-border)" }} />
        {(["all", ...Object.keys(CATEGORY_LABEL)] as (PresetCategory | "all")[]).map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className="h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
            style={{
              background: cat === c ? "rgba(233,95,24,0.14)" : "var(--vg-surface)",
              color: cat === c ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
              border: "1px solid var(--vg-border-subtle)",
            }}
          >
            {c === "all" ? "همهٔ دسته‌ها" : CATEGORY_LABEL[c]}
          </button>
        ))}
        <span className="vg-numeric ms-auto text-[12px]" style={{ color: "var(--vg-text-faint)" }}>
          {shown.length}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpen(p.familyId, p.prompt)}
            className="group relative block aspect-[3/4] w-full overflow-hidden rounded-xl text-start"
          >
            <img src={art(p.seed)} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
            <span className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.82), transparent 55%)" }} />
            {p.badge && (
              <span
                className="absolute top-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                style={{ insetInlineStart: "0.5rem", background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
              >
                {p.badge}
              </span>
            )}
            <span className="absolute inset-x-3 bottom-2.5 block">
              <span className="block text-[14px] font-extrabold leading-tight" style={{ color: "var(--vg-text)" }}>
                {p.title}
              </span>
              <span className="mt-0.5 block text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
                {getFamily(p.familyId)?.name}
              </span>
            </span>
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-16 text-center text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
          با این فیلترها چیزی نیست.
        </p>
      )}
    </motion.div>
  );
}
