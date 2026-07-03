import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, PlayCircle, CaretLeft, ImageSquare, VideoCamera, MagicWand, Heart, Sparkle } from "@phosphor-icons/react";
import { getFamily, type Family, type ModelKind } from "../data/models";
import { FEATURED, type FeaturedItem } from "../data/featured";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { useFavorites } from "../lib/favorites";
import { Logo, CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl, faNum } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { riseItem, riseParent } from "../lib/motion";

const KIND_LABEL: Record<FeaturedItem["kind"], string> = { model: "New model", template: "Template", feature: "New" };
const TOP = [...COMMUNITY].sort((a, b) => b.likes - a.likes);
const TEMPLATE = FEATURED.find((f) => f.kind === "template");

/* ---------- media ---------- */
function HeroMedia({ family }: { family?: Family }) {
  const cover = family?.cover;
  return (
    <>
      <div className="absolute inset-0" style={{ background: family?.grad ?? "#1b1b22" }} />
      {cover && isVideoUrl(cover) ? (
        <video src={cover} autoPlay muted loop playsInline preload="metadata" className="absolute inset-0 h-full w-full object-cover" />
      ) : cover ? (
        <motion.img
          src={cover}
          alt=""
          initial={{ scale: 1.06 }}
          animate={{ scale: 1.16 }}
          transition={{ duration: 6, ease: "linear" }}
          className="absolute inset-0 h-full w-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      ) : (
        <motion.div
          className="absolute inset-0"
          style={{ background: "radial-gradient(60% 55% at 28% 22%, rgba(255,255,255,0.3), transparent 70%)" }}
          initial={{ scale: 1, opacity: 0.5 }}
          animate={{ scale: 1.35, opacity: 0.9 }}
          transition={{ duration: 6, ease: "linear" }}
        />
      )}
    </>
  );
}

function Still({ family }: { family?: Family }) {
  const showImg = family?.cover && !isVideoUrl(family.cover);
  return (
    <>
      <div className="absolute inset-0" style={{ background: family?.grad ?? "#1b1b22" }} />
      {showImg && (
        <img src={family!.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => e.currentTarget.remove()} />
      )}
    </>
  );
}

/* ---------- immersive hero (full-bleed, melts into the page) ---------- */
function Hero({ items, onOpen }: { items: FeaturedItem[]; onOpen: (id: string, prompt?: string) => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((p) => (p + 1) % items.length), 4600);
    return () => clearInterval(id);
  }, [items.length]);
  const item = items[i]!;
  const f = item.familyId ? getFamily(item.familyId) : undefined;
  const isVideo = f?.kind === "video";

  return (
    <div className="relative h-[min(46vh,390px)] w-full overflow-hidden">
      <AnimatePresence>
        <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: "easeInOut" }} className="absolute inset-0">
          <HeroMedia family={f} />
          {/* bar legibility up top; melt into the page at the bottom */}
          <div className="absolute inset-x-0 top-0 h-24" style={{ background: "linear-gradient(to bottom, rgba(9,9,12,0.72), transparent)" }} />
          <div className="absolute inset-x-0 bottom-0 h-44" style={{ background: "linear-gradient(to top, var(--color-bg), rgba(9,9,12,0.55) 46%, transparent)" }} />

          {/* tap anywhere on the artwork to open the model */}
          <button
            onClick={() => item.familyId && onOpen(item.familyId, item.prompt)}
            aria-label={`${item.title} — بساز`}
            className="absolute inset-0 text-right"
          >
            <span className="absolute right-4 top-[76px] flex items-center gap-1.5">
              {isVideo && <PlayCircle size={18} weight="fill" className="text-white/90" />}
              <span className="t-label rounded-full bg-white/12 px-2.5 py-1 text-white backdrop-blur-md">{KIND_LABEL[item.kind]}</span>
            </span>
            <span className="absolute inset-x-4 bottom-[76px] block">
              <span className="mb-2 flex items-center gap-2">
                {f && <VendorMark vendor={f.vendor} size={24} />}
                <span className="t-caption text-white/70">{f?.vendor}</span>
              </span>
              <span className="t-display block text-white">{item.title}</span>
              <span className="mt-1.5 flex items-center justify-between">
                <span className="line-clamp-1 t-caption text-white/65">{item.subtitle}</span>
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-white/12 px-3 py-1.5 text-[12px] font-semibold text-white backdrop-blur-md">
                  <HeroCta />
                </span>
              </span>
            </span>
          </button>
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute bottom-[56px] left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
        {items.map((_, idx) => (
          <span key={idx} className="h-1.5 rounded-full transition-all" style={{ width: idx === i ? 18 : 6, background: idx === i ? "var(--color-accent)" : "rgba(255,255,255,0.4)" }} />
        ))}
      </div>
    </div>
  );
}

function HeroCta() {
  const { t } = useI18n();
  return (
    <>
      {t("home_make")}
      <ArrowRight size={13} weight="bold" className="rtl:-scale-x-100" />
    </>
  );
}

/* ---------- the signature: prompt bar ---------- */
function PromptBar({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="relative z-10 -mt-10 px-4">
      <button
        onClick={onCreate}
        className="flex w-full items-center gap-3 rounded-[22px] border border-line2 bg-card2/85 px-4 py-3.5 text-right backdrop-blur-xl transition-transform active:scale-[0.985]"
        style={{ boxShadow: "var(--shadow-pop), 0 0 0 1px var(--color-accent-soft)" }}
      >
        <motion.span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-accent"
          style={{ background: "var(--color-accent-soft)" }}
          animate={{ scale: [1, 1.08, 1] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          <Sparkle size={17} weight="fill" />
        </motion.span>
        <span className="flex-1 text-[14.5px] text-ink2">{t("home_prompt")}</span>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full" style={{ background: "var(--color-accent)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-accent)" }}>
          <ArrowRight size={16} weight="bold" className="rtl:-scale-x-100" />
        </span>
      </button>
    </div>
  );
}

function KindChip({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="tile-raised flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 text-[12.5px] font-medium">
      <span className="text-accent">{icon}</span>
      {label}
    </button>
  );
}

/* ---------- editorial section header (fa title + latin ghost) ---------- */
function SectionHeader({ title, en, onMore }: { title: string; en: string; onMore?: () => void }) {
  const { t, lang } = useI18n();
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <div className="flex items-baseline gap-2">
        <h2 className="t-h2">{title}</h2>
        {lang === "fa" && <span className="t-label ltr text-ink3 opacity-70">{en}</span>}
      </div>
      {onMore && (
        <button onClick={onMore} className="flex items-center gap-0.5 t-caption text-ink3 active:scale-95">
          {t("home_more")}
          <CaretLeft size={13} weight="bold" className="ltr:-scale-x-100" />
        </button>
      )}
    </div>
  );
}

/* ---------- trend + feed cards ---------- */
function TrendCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  return (
    <button onClick={onOpen} aria-label={`ساخته با ${f?.name ?? "مدل"} — ${faNum(p.likes.toLocaleString("en-US"))} پسند`} className="relative h-[196px] w-[136px] shrink-0 overflow-hidden rounded-card border border-line text-right active:scale-[0.98] transition-transform">
      <Still family={f} />
      <div className="scrim-media" />
      <div className="absolute left-2 top-2"><VendorMark vendor={f?.vendor ?? ""} size={18} /></div>
      <div className="absolute inset-x-2.5 bottom-2.5 flex items-center gap-1 text-[11px] text-white/90">
        <Heart size={12} weight="fill" className="text-accent" />
        {faNum(p.likes.toLocaleString("en-US"))}
      </div>
    </button>
  );
}

function FeedCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  return (
    <motion.div variants={riseItem} className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-card border border-line">
      <div className="relative w-full" style={{ aspectRatio: `${p.w}/${p.h}` }}>
        <Still family={f} />
        <div className="scrim-media" />
        <div className="absolute left-2.5 top-2.5"><VendorMark vendor={f?.vendor ?? ""} size={20} /></div>
        <div className="absolute inset-x-2.5 bottom-2.5 text-right">
          <div className="flex items-center justify-between text-[11px] text-white/80">
            <span>@{p.author}</span>
            <span className="flex items-center gap-1"><Heart size={11} weight="fill" className="text-accent" />{faNum(p.likes.toLocaleString("en-US"))}</span>
          </div>
          <p className="ltr mt-1 line-clamp-2 text-[11px] leading-snug text-white/85">{p.prompt}</p>
        </div>
      </div>
      <button onClick={onOpen} className="flex w-full items-center justify-center gap-1.5 bg-card py-2.5 text-[12.5px] font-semibold text-accent active:scale-[0.98] transition-transform">
        <MagicWand size={14} weight="fill" /> Remix
      </button>
    </motion.div>
  );
}

/* ============================================================ */
export default function Home({
  coins,
  onOpen,
  onModels,
  onCommunity,
  onWallet,
  onCreate,
}: {
  coins: number;
  onOpen: (familyId: string, prompt?: string) => void;
  onModels: (kind?: ModelKind) => void;
  onCommunity: () => void;
  onWallet: () => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const { favs } = useFavorites();
  const favFamilies = favs.map(getFamily).filter((f): f is Family => Boolean(f));

  return (
    <div className="relative z-10">
      {/* floating top bar, over the hero */}
      <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4 pt-4">
        <div className="flex items-center gap-2 text-ink">
          <Logo size={26} animate />
          <span className="font-display text-[19px] font-semibold tracking-tight">Vgen</span>
        </div>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {/* immersive hero + the signature prompt bar riding its edge */}
      <Hero items={FEATURED} onOpen={onOpen} />
      <PromptBar onCreate={onCreate} />

      {/* kind chips */}
      <div className="mt-3 flex gap-2 px-4">
        <KindChip icon={<ImageSquare size={16} />} label={t("home_image")} onClick={() => onModels("image")} />
        <KindChip icon={<VideoCamera size={16} />} label={t("home_video")} onClick={() => onModels("video")} />
        <KindChip icon={<MagicWand size={16} />} label={t("home_template")} onClick={() => (TEMPLATE ? onOpen(TEMPLATE.familyId!, TEMPLATE.prompt) : onModels())} />
      </div>

      <div className="px-4 pt-8">
        {/* favorites */}
        {favFamilies.length > 0 && (
          <div className="mb-7">
            <SectionHeader title={t("home_shortcuts")} en="Shortcuts" />
            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 no-scrollbar">
              {favFamilies.map((f) => (
                <button key={f.id} onClick={() => onOpen(f.id)} className="flex shrink-0 items-center gap-2.5 rounded-2xl border border-line bg-card p-1.5 pe-3.5 active:scale-[0.97] transition-transform">
                  <span className="relative h-9 w-9 overflow-hidden rounded-xl" style={{ background: f.grad }}>
                    <span className="absolute bottom-0.5 right-0.5"><VendorMark vendor={f.vendor} size={15} /></span>
                  </span>
                  <span className="text-[12.5px] font-medium">{f.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* trends */}
        <div className="mb-7">
          <SectionHeader title={t("home_trending")} en="Trending" onMore={onCommunity} />
          <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
            {TOP.slice(0, 8).map((p) => (
              <TrendCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
            ))}
          </div>
        </div>

        {/* for you */}
        <div>
          <SectionHeader title={t("home_foryou")} en="For you" onMore={onCommunity} />
          <motion.div variants={riseParent} initial="hidden" animate="show" className="[column-fill:_balance] columns-2 gap-3">
            {COMMUNITY.slice(0, 6).map((p) => (
              <FeedCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
            ))}
          </motion.div>
          <button onClick={onCommunity} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-card border border-line bg-card py-3 text-[13px] font-medium active:scale-[0.99] transition-transform">
            {t("home_see_community")}
            <ArrowRight size={15} weight="bold" className="rtl:-scale-x-100" />
          </button>
        </div>
      </div>
    </div>
  );
}
