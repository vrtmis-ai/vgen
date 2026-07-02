import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, PlayCircle, CaretLeft, ImageSquare, VideoCamera, MagicWand, Heart, Star } from "@phosphor-icons/react";
import { getFamily, type Family, type ModelKind } from "../data/models";
import { FEATURED, type FeaturedItem } from "../data/featured";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { useFavorites } from "../lib/favorites";
import { Logo, CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl, faNum } from "../lib/format";
import { EASE_OUT, riseItem, riseParent } from "../lib/motion";

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

/* ---------- hero ---------- */
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
    <div className="relative h-[238px] w-full overflow-hidden rounded-bezel border border-line" style={{ boxShadow: "var(--shadow-pop)" }}>
      <AnimatePresence>
        <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.9, ease: "easeInOut" }} className="absolute inset-0">
          <HeroMedia family={f} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.88), rgba(0,0,0,0.02) 62%)" }} />
          <div className="absolute right-4 top-4 flex items-center gap-1.5">
            {isVideo && <PlayCircle size={18} weight="fill" className="text-white/90" />}
            <span className="t-label rounded-full bg-white/12 px-2.5 py-1 text-white backdrop-blur-md">{KIND_LABEL[item.kind]}</span>
          </div>
          <div className="absolute inset-x-4 bottom-4">
            <div className="mb-2 flex items-center gap-2">
              {f && <VendorMark vendor={f.vendor} size={26} />}
              <span className="t-caption text-white/70">{f?.vendor}</span>
            </div>
            <div className="t-h1 text-white">{item.title}</div>
            <div className="mt-1 line-clamp-1 t-caption text-white/70">{item.subtitle}</div>
            <button
              onClick={() => item.familyId && onOpen(item.familyId, item.prompt)}
              className="btn-accent mt-3 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold"
            >
              بساز
              <ArrowRight size={15} weight="bold" className="-scale-x-100" />
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute bottom-4 left-4 flex gap-1.5">
        {items.map((_, idx) => (
          <span key={idx} className="h-1.5 rounded-full transition-all" style={{ width: idx === i ? 18 : 6, background: idx === i ? "var(--color-accent)" : "rgba(255,255,255,0.4)" }} />
        ))}
      </div>
    </div>
  );
}

/* ---------- tool row ---------- */
function ToolCard({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-1 flex-col items-center gap-2 rounded-card border border-line bg-card py-3.5 transition-transform active:scale-[0.97]">
      <span className="grid h-10 w-10 place-items-center rounded-2xl text-accent" style={{ background: "var(--color-accent-soft)" }}>
        {icon}
      </span>
      <span className="text-[12.5px] font-medium">{label}</span>
    </button>
  );
}

/* ---------- section header ---------- */
function SectionHeader({ title, onMore }: { title: string; onMore?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="t-h2">{title}</h2>
      {onMore && (
        <button onClick={onMore} className="flex items-center gap-0.5 t-caption text-ink3 active:scale-95">
          بیشتر
          <CaretLeft size={13} weight="bold" />
        </button>
      )}
    </div>
  );
}

/* ---------- trend + feed cards ---------- */
function TrendCard({ p, onOpen }: { p: CommunityPost; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  return (
    <button onClick={onOpen} className="relative h-[196px] w-[136px] shrink-0 overflow-hidden rounded-card border border-line text-right active:scale-[0.98] transition-transform">
      <Still family={f} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78), transparent 55%)" }} />
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
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8), transparent 55%)" }} />
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
}: {
  coins: number;
  onOpen: (familyId: string, prompt?: string) => void;
  onModels: (kind?: ModelKind) => void;
  onCommunity: () => void;
  onWallet: () => void;
}) {
  const { favs } = useFavorites();
  const favFamilies = favs.map(getFamily).filter((f): f is Family => Boolean(f));

  return (
    <div className="relative z-10 px-4 pt-4">
      {/* top bar */}
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink">
          <Logo size={26} animate />
          <span className="font-display text-[19px] font-semibold tracking-tight">Vgen</span>
        </div>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {/* hero */}
      <div className="mb-6"><Hero items={FEATURED} onOpen={onOpen} /></div>

      {/* create tools */}
      <div className="mb-7 flex gap-3">
        <ToolCard icon={<ImageSquare size={22} />} label="عکس" onClick={() => onModels("image")} />
        <ToolCard icon={<VideoCamera size={22} />} label="ویدیو" onClick={() => onModels("video")} />
        <ToolCard icon={<MagicWand size={22} />} label="تمپلیت" onClick={() => (TEMPLATE ? onOpen(TEMPLATE.familyId!, TEMPLATE.prompt) : onModels())} />
      </div>

      {/* favorites */}
      {favFamilies.length > 0 && (
        <div className="mb-7">
          <SectionHeader title="میانبرهای تو" />
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
        <SectionHeader title="ترندها" onMore={onCommunity} />
        <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
          {TOP.slice(0, 8).map((p) => (
            <TrendCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
          ))}
        </div>
      </div>

      {/* for you */}
      <div>
        <SectionHeader title="برای تو" onMore={onCommunity} />
        <motion.div variants={riseParent} initial="hidden" animate="show" className="[column-fill:_balance] columns-2 gap-3">
          {COMMUNITY.slice(0, 6).map((p) => (
            <FeedCard key={p.id} p={p} onOpen={() => onOpen(p.familyId, p.prompt)} />
          ))}
        </motion.div>
        <button onClick={onCommunity} className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-card border border-line bg-card py-3 text-[13px] font-medium active:scale-[0.99] transition-transform">
          دیدن همه در کامیونیتی
          <ArrowRight size={15} weight="bold" className="-scale-x-100" />
        </button>
      </div>
    </div>
  );
}
