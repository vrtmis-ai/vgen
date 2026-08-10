import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Sparkle, Copy, Check } from "@phosphor-icons/react";
import { PRESETS, CATEGORY_LABEL, type Preset, type PresetCategory } from "../data/presets";
import { published } from "../data/content";
import { getFamily } from "../data/models";
import { VendorMark } from "../components/VendorMark";
import { riseItem, riseParent } from "../lib/motion";

/* ---------------------------------------------------------------------------
   The effects index — the destination "همهٔ افکت‌ها" should always have had.

   Measured against /collection/effects. Two things there that we did not have,
   and both are structural rather than cosmetic:

   1. The card has TWO destinations. The whole tile links to a detail page for
      that effect; a separate 112x40 "Generate" button goes straight to the
      studio with the prompt loaded. Ours only had the second, which meant the
      only way to find out what an effect actually does was to spend a click
      landing in the studio — the exact complaint that started this page.

   2. The title on the card is 30px, not 14px. On a 368px tile that is a poster,
      and it is what makes a wall of 120 of these scannable at a glance. Ours is
      22px because Persian glyphs at one size read heavier than Latin ones.

   The card art is uniformly 3:4, so their masonry and a plain 5-column grid
   produce the same wall; we keep the grid.
   --------------------------------------------------------------------------- */

const art = (seed: string, n = 0) => `https://picsum.photos/seed/${seed}${n ? `-${n}` : ""}/480/640`;

/** The detail page. Theirs is a gallery of that effect applied to different
 *  subjects — the honest answer to "what will this do to my shot?" — with the
 *  same Generate button pinned where the eye already is.
 *
 *  Ours adds the prompt itself. Theirs keeps it hidden; showing it is the whole
 *  reason a preset is worth trusting, and it is also how someone learns to
 *  write their own. */
function EffectDetail({ preset, onGenerate, onBack }: { preset: Preset; onGenerate: () => void; onBack: () => void }) {
  const family = getFamily(preset.familyId);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [preset.id]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-20 pt-6">
      <button
        onClick={onBack}
        className="mb-6 flex h-9 items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold transition-colors hover:bg-white/[0.06]"
        style={{ color: "var(--vg-text-muted)" }}
      >
        {/* Points at the trailing edge under RTL, which is the way back. */}
        <ArrowRight size={14} weight="bold" />
        همهٔ افکت‌ها
      </button>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div>
          <h1
            className="text-[34px] font-extrabold leading-[1.1] md:text-[46px]"
            style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)", letterSpacing: "-0.02em" }}
          >
            {preset.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span
              className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[11.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
            >
              {family && <VendorMark vendor={family.vendor} size={13} />}
              <bdi>{family?.name}</bdi>
            </span>
            <span
              className="flex h-7 items-center rounded-md px-2 text-[11.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
            >
              {CATEGORY_LABEL[preset.category]}
            </span>
            <span
              className="flex h-7 items-center rounded-md px-2 text-[11.5px] font-semibold"
              style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
            >
              {preset.kind === "video" ? "ویدیو" : "تصویر"}
            </span>
          </div>

          {/* Their gallery: the same effect on different subjects. One large,
              the rest as a strip — a wall of equal thumbnails would not tell
              you which one is the effect and which are variations. */}
          <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
            <img
              src={art(preset.seed)}
              alt={`نمونهٔ ${preset.title}`}
              className="aspect-[3/4] w-full rounded-2xl object-cover sm:col-span-2 sm:aspect-[16/9]"
            />
            {[1, 2, 3, 4].map((n) => (
              <img
                key={n}
                src={art(preset.seed, n)}
                alt=""
                loading="lazy"
                className="aspect-[3/4] w-full rounded-xl object-cover"
              />
            ))}
          </div>
        </div>

        {/* The action column stays beside the gallery on desktop so Generate is
            never scrolled away from the thing it acts on. */}
        <div className="lg:sticky lg:top-20">
          <div className="rounded-2xl p-4" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
            <p className="text-[12.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
              این پرامپت کامل نوشته شده. کافی است سوژه‌ی خودت را آخرش اضافه کنی.
            </p>
            <button
              onClick={onGenerate}
              className="btn-accent mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl text-[13.5px] font-bold"
            >
              <Sparkle size={15} weight="fill" />
              ساختن با این افکت
            </button>
          </div>

          {/* The prompt, in full and copyable. Latin text inside an RTL column,
              so it needs its own direction or the trailing comma jumps. */}
          <div className="mt-3 rounded-2xl p-4" style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-bold" style={{ color: "var(--vg-text)" }}>
                پرامپت
              </span>
              <button
                onClick={() => {
                  void navigator.clipboard?.writeText(preset.prompt).then(() => setCopied(true));
                }}
                className="flex h-7 items-center gap-1 rounded-md px-2 text-[11.5px] font-semibold transition-colors hover:bg-white/[0.06]"
                style={{ color: copied ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }}
              >
                {copied ? <Check size={12} weight="bold" /> : <Copy size={12} />}
                {copied ? "کپی شد" : "کپی"}
              </button>
            </div>
            <p className="ltr mt-2 text-[12px] leading-5" style={{ color: "var(--vg-text-secondary)" }}>
              {preset.prompt}
              {preset.openEnded && (
                <span style={{ color: "var(--vg-text-faint)" }}> [سوژه‌ی تو]</span>
              )}
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function EffectCard({ preset, onOpen, onGenerate }: { preset: Preset; onOpen: () => void; onGenerate: () => void }) {
  const family = getFamily(preset.familyId);
  return (
    <motion.div variants={riseItem} className="group relative aspect-[3/4] overflow-hidden rounded-xl">
      <img
        src={art(preset.seed)}
        alt=""
        loading="lazy"
        className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
      />
      <span className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.86), rgba(0,0,0,0.15) 48%, transparent 72%)" }} />

      {/* The whole tile is the link to the detail page. It sits under the
          Generate button in the stack, so Generate wins its own 112x40 and the
          rest of the card still opens the effect. */}
      <button onClick={onOpen} className="absolute inset-0 z-0" aria-label={`دیدن افکت ${preset.title}`} />

      {preset.badge && (
        <span
          className="pointer-events-none absolute top-2 z-10 rounded-md px-1.5 py-0.5 text-[10px] font-bold"
          style={{ insetInlineStart: "0.5rem", background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          {preset.badge}
        </span>
      )}

      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
        {/* 22px, not 14. Theirs is 30px Latin on a tile this wide; Persian at
            that size on the same box overruns two lines on the longer names. */}
        <p
          className="text-[19px] font-extrabold leading-[1.15] sm:text-[22px]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)", textShadow: "0 1px 12px rgba(0,0,0,0.5)" }}
        >
          {preset.title}
        </p>
        <p className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          {family && <VendorMark vendor={family.vendor} size={11} />}
          <bdi>{family?.name}</bdi>
        </p>

        {/* Quiet accent, as theirs is: accent text on the accent at 5%. A solid
            fill here would fight the artwork on all 120 tiles at once. */}
        <button
          onClick={onGenerate}
          // Named for the effect, not just "بساز". The visible word stays short
          // because the title is right above it; the accessible name cannot rely
          // on that, and eighteen buttons called "بساز" in a row is what a
          // screen reader would otherwise read out.
          aria-label={`ساختن با افکت ${preset.title}`}
          className="vg-tap pointer-events-auto mt-2.5 flex h-9 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-bold backdrop-blur-sm transition-colors"
          style={{ background: "var(--vg-primary-a14)", color: "var(--vg-primary-soft)" }}
        >
          <Sparkle size={13} weight="fill" />
          بساز
        </button>
      </div>
    </motion.div>
  );
}

export default function Effects({ onOpen }: { onOpen: (familyId: string, prompt?: string) => void }) {
  const all = useMemo(() => published(PRESETS), []);
  const [cat, setCat] = useState<PresetCategory | "all">("all");
  const [kind, setKind] = useState<"all" | "video" | "image">("all");
  const [detail, setDetail] = useState<Preset | null>(null);

  const shown = all.filter((p) => (cat === "all" || p.category === cat) && (kind === "all" || p.kind === kind));

  if (detail) {
    return (
      <EffectDetail
        preset={detail}
        onBack={() => setDetail(null)}
        onGenerate={() => onOpen(detail.familyId, detail.prompt)}
      />
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-20 pt-8">
      {/* 72px with -0.05em tracking on theirs, in the accent. The negative
          tracking is what stops a word that size reading as a mistake. */}
      <h1
        // clamp, not a breakpoint jump. This is the largest type in the app and
        // it held 46px flat from 375 to 768 and then snapped to 68 — the one
        // size where a step is visible as a step. Same endpoints, scaled through.
        className="text-center text-[clamp(2.875rem,1.55rem+5.65vw,4.25rem)] font-extrabold leading-none"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-primary-soft)", letterSpacing: "-0.04em" }}
      >
        افکت‌های آماده
      </h1>
      <p className="mx-auto mt-3 max-w-[52ch] text-center text-[13.5px] leading-6" style={{ color: "var(--vg-text-muted)" }}>
        هر افکت یک پرامپت کامل است که یک نفر قبلاً نوشته. انتخابش کن، سوژه‌ی خودت را اضافه کن، بساز.
      </p>

      {/* The name cloud. Every effect is one click from here, which is the
          whole point — a scroll is not an index. Clicking a name opens the
          effect, matching what clicking its tile now does. */}
      <div className="mx-auto mt-7 flex max-w-[900px] flex-wrap justify-center gap-1.5">
        {all.map((p) => (
          <button
            key={p.id}
            onClick={() => setDetail(p)}
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
            aria-pressed={kind === k}
            className="h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
            style={{
              background: kind === k ? "var(--vg-primary-a14)" : "var(--vg-surface)",
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
            aria-pressed={cat === c}
            className="h-9 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
            style={{
              background: cat === c ? "var(--vg-primary-a14)" : "var(--vg-surface)",
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

      <motion.div
        variants={riseParent}
        initial="hidden"
        animate="show"
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
      >
        {shown.map((p) => (
          <EffectCard key={p.id} preset={p} onOpen={() => setDetail(p)} onGenerate={() => onOpen(p.familyId, p.prompt)} />
        ))}
      </motion.div>

      {shown.length === 0 && (
        <p className="py-16 text-center text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
          با این فیلترها چیزی نیست.
        </p>
      )}
    </motion.div>
  );
}
