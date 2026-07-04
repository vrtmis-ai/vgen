import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, MagicWand } from "@phosphor-icons/react";
import { getFamily } from "../data/models";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { CreditPill } from "../components/chrome";
import { VendorMark } from "../components/VendorMark";
import { faNum, isVideoUrl } from "../lib/format";
import { useI18n } from "../lib/i18n";

const TRENDS = ["Trending", "Cinematic", "Cyberpunk", "Portraits", "Product", "Anime", "3D"];

function PostCard({ p, i, onOpen }: { p: CommunityPost; i: number; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
      className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line"
    >
      <div className="relative w-full" style={{ aspectRatio: `${p.w}/${p.h}`, background: f?.grad }}>
        {f?.cover && !isVideoUrl(f.cover) && (
          <img src={f.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => e.currentTarget.remove()} />
        )}
        <div className="scrim-media" />
        {f && <div className="absolute start-2.5 top-2.5"><VendorMark vendor={f.vendor} size={22} /></div>}
        <div className="absolute inset-x-2.5 bottom-2.5 text-start">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-white/80">@{p.author}</span>
            <span className="flex items-center gap-1 text-[11px] text-white/80">
              <Heart size={12} weight="fill" className="text-accent" />
              {faNum(p.likes.toLocaleString("en-US"))}
            </span>
          </div>
          <p className="ltr mt-1 line-clamp-2 text-[11.5px] leading-snug text-white/85">{p.prompt}</p>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="flex w-full items-center justify-center gap-1.5 bg-card py-2.5 text-[12.5px] font-semibold text-accent active:scale-[0.98] transition-transform"
      >
        <MagicWand size={14} weight="fill" />
        Remix
        {f && <span className="font-normal text-ink3">· {f.name}</span>}
      </button>
    </motion.div>
  );
}

export default function Community({
  coins,
  onOpen,
  onWallet,
}: {
  coins: number;
  onOpen: (familyId: string, prompt?: string) => void;
  onWallet: () => void;
}) {
  const { t } = useI18n();
  const [trend, setTrend] = useState("Trending");
  return (
    <div className="relative z-10 px-4 pt-4">
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[20px] font-semibold tracking-tight">{t("com_title")}</span>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {/* trend chips */}
      <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 no-scrollbar">
        {TRENDS.map((tr) => {
          const on = tr === trend;
          return (
            <button
              key={tr}
              onClick={() => setTrend(tr)}
              className="shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px] transition-colors active:scale-95"
              style={
                on
                  ? { borderColor: "transparent", background: "var(--color-accent)", color: "var(--color-on-accent)" }
                  : { borderColor: "var(--color-line)", background: "var(--color-card2)", color: "var(--color-ink2)" }
              }
            >
              {tr === "Trending" ? "🔥 Trending" : tr}
            </button>
          );
        })}
      </div>

      <div className="[column-fill:_balance] columns-2 gap-3">
        {COMMUNITY.map((p, i) => (
          <PostCard key={p.id} p={p} i={i} onOpen={() => onOpen(p.familyId, p.prompt)} />
        ))}
      </div>
    </div>
  );
}
