import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, DownloadSimple, ArrowsClockwise, FilmSlate, ShareNetwork } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { Logo } from "../components/chrome";
import { useI18n, type TKey } from "../lib/i18n";

const STAGE_KEYS: TKey[] = ["r_stage1", "r_stage2", "r_stage3", "r_stage4"];

export default function Result({
  gen,
  instant,
  onBack,
  onRegenerate,
  onToVideo,
  onDone,
}: {
  gen: Generation;
  instant?: boolean;
  onBack: () => void;
  onRegenerate: () => void;
  onToVideo: () => void;
  onDone?: () => void;
}) {
  const { t, n } = useI18n();
  const [pct, setPct] = useState(instant ? 100 : 0);
  const done = pct >= 100;
  const firedDone = useRef(false);

  useEffect(() => {
    if (instant) return;
    setPct(0);
    firedDone.current = false;
    const id = setInterval(() => {
      setPct((p) => {
        if (p >= 100) {
          clearInterval(id);
          return 100;
        }
        return Math.min(100, p + Math.random() * 9 + 3);
      });
    }, 220);
    return () => clearInterval(id);
  }, [gen.id, instant]);

  useEffect(() => {
    if (done && !instant && !firedDone.current) {
      firedDone.current = true;
      onDone?.();
    }
  }, [done, instant, onDone]);

  const stage = t(STAGE_KEYS[Math.min(STAGE_KEYS.length - 1, Math.floor((pct / 100) * STAGE_KEYS.length))]!);
  const ratio = gen.w / gen.h;

  return (
    <div className="relative z-10 min-h-[100dvh] px-4 pt-4">
      <div className="mb-4 flex items-center gap-3">
        <button onClick={onBack} aria-label={t("nav_home")} className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95">
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{done ? t("r_result") : t("r_making")}</div>
      </div>

      <div className="rounded-bezel border border-line bg-card p-1.5">
        <div
          className="relative w-full overflow-hidden rounded-[1.4rem]"
          style={{ aspectRatio: `${ratio}`, background: done ? gen.grad : "#161619" }}
        >
          {!done && <div className="shimmer absolute inset-0" />}
          <AnimatePresence>
            {!done && (
              <motion.div exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-ink">
                <Logo size={48} animate />
                <div className="text-[12.5px] text-ink2">{stage}</div>
                <div className="h-1 w-40 overflow-hidden rounded-full bg-line2">
                  <motion.div className="h-full" style={{ background: "var(--color-accent)" }} animate={{ width: `${pct}%` }} transition={{ ease: "easeOut" }} />
                </div>
                <div className="text-[11px] tabular-nums text-ink3">{n(Math.floor(pct))}٪</div>
              </motion.div>
            )}
          </AnimatePresence>
          {done && (
            <motion.div
              initial={instant ? false : { opacity: 0, scale: 1.04, filter: "blur(8px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-0"
            >
              <div className="absolute inset-0" style={{ background: gen.grad }} />
              <div className="absolute start-2 top-2 rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">
                {t("r_sample")}
              </div>
            </motion.div>
          )}
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2 text-[12px] text-ink3">
        <span className="rounded-full bg-card2 px-2.5 py-1 text-ink2">{gen.name}</span>
        <span>·</span>
        <span>{gen.vendor}</span>
      </div>
      {gen.prompt && <p className="ltr mt-2 line-clamp-2 text-[12.5px] text-ink2">{gen.prompt}</p>}

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        <ActionBtn icon={<DownloadSimple size={20} />} label={t("r_download")} onClick={() => {}} disabled={!done} />
        <ActionBtn icon={<ArrowsClockwise size={20} />} label={t("r_regen")} onClick={onRegenerate} disabled={!done} />
        {gen.kind === "image" ? (
          <ActionBtn icon={<FilmSlate size={20} />} label={t("r_to_video")} onClick={onToVideo} disabled={!done} highlight />
        ) : (
          <ActionBtn icon={<ShareNetwork size={20} />} label={t("r_share")} onClick={() => {}} disabled={!done} />
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon,
  label,
  onClick,
  disabled,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1.5 rounded-2xl border py-3 transition-all active:scale-[0.97] disabled:opacity-40 ${
        highlight ? "btn-accent border-transparent" : "border-line bg-card2 text-ink"
      }`}
    >
      {icon}
      <span className="text-[11.5px]">{label}</span>
    </button>
  );
}
