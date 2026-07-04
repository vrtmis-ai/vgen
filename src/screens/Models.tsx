import { useState } from "react";
import { motion } from "framer-motion";
import { Star, ArrowRight } from "@phosphor-icons/react";
import { IMAGE_FAMILIES, VIDEO_FAMILIES, type Family, type ModelKind } from "../data/models";
import { useFavorites } from "../lib/favorites";
import { CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { isVideoUrl } from "../lib/format";
import { useI18n } from "../lib/i18n";

function Badge({ text }: { text: string }) {
  return <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] font-medium text-ink backdrop-blur-sm">{text}</span>;
}

function GridCard({ f, i, fav, onToggleFav, onOpen }: { f: Family; i: number; fav: boolean; onToggleFav: () => void; onOpen: () => void }) {
  const { t, n } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-bezel border border-line bg-card p-1.5"
    >
      <button onClick={onOpen} className="block w-full text-right active:scale-[0.97] transition-transform">
        <div className="relative aspect-square overflow-hidden rounded-[1.4rem]" style={{ background: f.grad }}>
          {f.cover && !isVideoUrl(f.cover) && (
            <img src={f.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => e.currentTarget.remove()} />
          )}
          <div className="absolute inset-0" style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16)" }} />
          {f.badge && <div className="absolute end-2 top-2"><Badge text={f.badge} /></div>}
          <div className="absolute bottom-2 start-2"><VendorMark vendor={f.vendor} size={22} /></div>
          {f.variants.length > 1 && (
            <div className="absolute bottom-2 end-2">
              <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">{n(f.variants.length)} {t("g_versions")}</span>
            </div>
          )}
        </div>
        <div className="px-2 pt-2.5 pb-1.5">
          <div className="text-[13px] font-medium leading-tight">{f.name}</div>
          <div className="text-[11px] text-ink3">{f.vendor}</div>
        </div>
      </button>
      <button
        onClick={onToggleFav}
        aria-label={fav ? t("fav_remove") : t("fav_add")}
        className="absolute start-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-bg/55 backdrop-blur-sm active:scale-90"
      >
        <Star size={16} weight={fav ? "fill" : "regular"} className={fav ? "text-accent" : "text-white/80"} />
      </button>
    </motion.div>
  );
}

export default function Models({
  coins,
  onOpen,
  onWallet,
  onBack,
  initialKind = "image",
}: {
  coins: number;
  onOpen: (familyId: string) => void;
  onWallet: () => void;
  onBack: () => void;
  initialKind?: ModelKind;
}) {
  const [tab, setTab] = useState<ModelKind>(initialKind);
  const { t } = useI18n();
  const { toggle, has } = useFavorites();
  const families = tab === "image" ? IMAGE_FAMILIES : VIDEO_FAMILIES;

  return (
    <div className="relative z-10 px-4 pt-4 pb-10">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label={t("nav_home")} className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95">
            <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
          </button>
          <span className="t-h1">{t("mdl_title")}</span>
        </div>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      <div className="mb-4 flex gap-1.5 rounded-2xl bg-card2 p-1">
        {(["image", "video"] as ModelKind[]).map((k) => {
          const on = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 rounded-[12px] py-2.5 text-[13px] transition-colors active:scale-[0.98] ${
                on ? "bg-accent font-medium text-on-accent" : "text-ink3"
              }`}
            >
              {t(k === "image" ? "kind_image" : "kind_video")}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {families.map((f, i) => (
          <GridCard key={f.id} f={f} i={i} fav={has(f.id)} onToggleFav={() => toggle(f.id)} onOpen={() => onOpen(f.id)} />
        ))}
      </div>
    </div>
  );
}
