import { useState } from "react";
import { motion } from "framer-motion";
import { Heart, MagicWand } from "@phosphor-icons/react";
import { getFamily } from "../data/models";
import { COMMUNITY, type CommunityPost } from "../data/community";
import { VendorMark } from "../components/VendorMark";
import { faNum, isVideoUrl } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useImageFallback } from "../lib/useImageFallback";

/* Persian labels, and no emoji — the system bans them, and "🔥 Trending" was
   the only one left in the app. */
const TRENDS = [
  { key: "hot", label: "داغ" },
  { key: "cinematic", label: "سینمایی" },
  { key: "cyberpunk", label: "سایبرپانک" },
  { key: "portrait", label: "پرتره" },
  { key: "product", label: "محصول" },
  { key: "anime", label: "انیمه" },
  { key: "3d", label: "سه‌بعدی" },
];

function PostCard({ p, i, onOpen }: { p: CommunityPost; i: number; onOpen: () => void }) {
  const f = getFamily(p.familyId);
  const [coverFailed, onCoverError] = useImageFallback();
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
      className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line"
    >
      <div className="relative w-full" style={{ aspectRatio: `${p.w}/${p.h}`, background: f?.grad }}>
        {f?.cover && !isVideoUrl(f.cover) && !coverFailed && (
          <img src={f.cover} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={onCoverError} />
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

/* No wallet prop any more: the balance lives in the top bar, and passing it
   here is what let the duplicate pill exist. */
export default function Community({ onOpen }: { onOpen: (familyId: string, prompt?: string) => void }) {
  const { t } = useI18n();
  const [trend, setTrend] = useState(TRENDS[0]!);
  return (
    /* Rebuilt for the top-bar shell. It used to print its own title row with a
       CreditPill in it, which put a second balance directly under the one in
       the chrome — the screen predates the bar and was still carrying the
       header it needed when it was a tab in a 480px column. */
    <div className="relative z-10 mx-auto w-full max-w-[var(--vg-container-max)] px-4 pb-16 pt-5 md:px-8">
      <h1 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        {t("com_title")}
      </h1>
      <p className="mt-0.5 text-[13px]" style={{ color: "var(--vg-text-muted)" }}>
        هرچه اینجاست را صاحبش خودش منتشر کرده. پرامپتش باز است — بردار و عوضش کن.
      </p>

      <div className="hide-scrollbar -mx-4 my-4 flex gap-1.5 overflow-x-auto px-4 md:mx-0 md:px-0">
        {TRENDS.map((tr) => {
          const on = tr === trend;
          return (
            <button
              key={tr.key}
              onClick={() => setTrend(tr)}
              className="h-9 shrink-0 rounded-lg px-3 text-[12.5px] font-semibold transition-colors"
              style={{
                background: on ? "rgba(233,95,24,0.14)" : "var(--vg-surface)",
                color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                border: "1px solid var(--vg-border-subtle)",
              }}
            >
              {tr.label}
            </button>
          );
        })}
      </div>

      {/* Masonry widens with the viewport instead of staying at two phone
          columns on a 1440px window. */}
      <div className="[column-fill:_balance] columns-2 gap-3 md:columns-3 xl:columns-4">
        {COMMUNITY.filter((p) => p.status === "approved").map((p, i) => (
          <PostCard key={p.id} p={p} i={i} onOpen={() => onOpen(p.familyId, p.prompt)} />
        ))}
      </div>
    </div>
  );
}
