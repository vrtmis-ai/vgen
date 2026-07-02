import { motion } from "framer-motion";
import { ImagesSquare, CircleNotch } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { CreditPill } from "../components/chrome";

function GenCard({ g, i, onOpen }: { g: Generation; i: number; onOpen: () => void }) {
  const running = g.status === "running";
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
      onClick={onOpen}
      className="mb-3 block w-full break-inside-avoid overflow-hidden rounded-bezel border border-line text-right active:scale-[0.98] transition-transform"
    >
      <div className="relative w-full" style={{ aspectRatio: `${g.w}/${g.h}`, background: g.grad }}>
        {running && <div className="shimmer absolute inset-0 bg-[#161619]/60" />}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.72), transparent 55%)" }} />
        <div className="absolute left-2 top-2">
          {running ? (
            <span className="flex items-center gap-1 rounded-full bg-bg/65 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">
              <CircleNotch size={11} className="animate-spin" />
              در حال ساخت
            </span>
          ) : (
            <span className="rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">{g.kind === "video" ? "ویدیو" : "تصویر"}</span>
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

export default function Gallery({
  gens,
  coins,
  onOpen,
  onBrowse,
  onWallet,
}: {
  gens: Generation[];
  coins: number;
  onOpen: (g: Generation) => void;
  onBrowse: () => void;
  onWallet: () => void;
}) {
  return (
    <div className="relative z-10 px-4 pt-4">
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[20px] font-semibold tracking-tight">گالری</span>
        <CreditPill coins={coins} onClick={onWallet} />
      </div>

      {gens.length === 0 ? (
        <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-8 text-center">
          <div className="text-ink3 opacity-50">
            <ImagesSquare size={44} />
          </div>
          <div className="text-[14px] font-medium">هنوز چیزی نساختی</div>
          <div className="text-[12.5px] text-ink3">هر چی بسازی این‌جا جمع می‌شه</div>
          <button onClick={onBrowse} className="btn-accent mt-1 rounded-full px-5 py-2.5 text-[13px] font-semibold">
            رفتن به مدل‌ها
          </button>
        </div>
      ) : (
        <div className="[column-fill:_balance] columns-2 gap-3">
          {gens.map((g, i) => (
            <GenCard key={g.id} g={g} i={i} onOpen={() => onOpen(g)} />
          ))}
        </div>
      )}
    </div>
  );
}
