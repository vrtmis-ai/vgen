import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, DownloadSimple, ArrowsClockwise, FilmSlate, ShareNetwork } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { Logo } from "../components/chrome";
import { GenerationMedia } from "../components/GenerationMedia";
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
  /* Read, not simulated.
     This screen used to run its own interval, which was fine while a job could
     only be watched from here. It can now also be watched in the studio canvas
     it started in, and two independent counters drift — the one you are not
     looking at keeps ticking after the job is done. App drives the single
     ticker and writes `progress` onto the generation; this reads it.

     `instant` still means "opened from history", where there is nothing to
     watch and the answer is simply 100. */
  const pct = instant ? 100 : Math.round(gen.progress ?? (gen.status === "done" ? 100 : 0));
  const done = gen.status === "done" || pct >= 100;
  const firedDone = useRef(false);

  useEffect(() => {
    if (done && !instant && !firedDone.current) {
      firedDone.current = true;
      onDone?.();
    }
  }, [done, instant, onDone]);

  const stage = t(STAGE_KEYS[Math.min(STAGE_KEYS.length - 1, Math.floor((pct / 100) * STAGE_KEYS.length))]!);
  const ratio = gen.w / gen.h;

  /* The same anchor StudioImage's viewer uses. This button was `() => {}` — a
     control that looks live, is not disabled, and does nothing when pressed,
     next to the file it claims to save.

     The extension comes from `kind` rather than from the URL: these links are
     signed and end in a signature, so there is no extension in them to read. */
  const download = () => {
    if (!gen.outputUrl) return;
    const el = document.createElement("a");
    el.href = gen.outputUrl;
    el.download = `vgen-${gen.id}.${gen.kind === "video" ? "mp4" : gen.kind === "audio" ? "mp3" : "png"}`;
    el.rel = "noopener";
    el.click();
  };

  return (
    /* The media leads and the controls sit beside it from `md`. In a 480px
       column a 16:9 result was 270px tall with its actions pushed below the
       fold — the one screen where the thing the user just paid for should be
       the biggest object on the page. */
    <div className="relative z-10 mx-auto min-h-[100dvh] w-full max-w-[1100px] px-4 pb-16 pt-4 md:px-8">
      <div className="mb-4 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label={t("nav_home")}
          className="grid h-9 w-9 place-items-center rounded-full bg-card2 active:scale-95"
        >
          <ArrowRight size={18} weight="bold" className="ltr:-scale-x-100" />
        </button>
        <div className="text-[15px] font-medium">{done ? t("r_result") : t("r_making")}</div>
      </div>

      <div className="md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] md:items-start md:gap-6">
        <div className="rounded-bezel border border-line bg-card p-1.5">
          <div
            className="relative w-full overflow-hidden rounded-[1.4rem]"
            // Audio has no frame to fill, so it gets a short fixed band instead of
            // an aspect box that would otherwise render as a tall empty rectangle.
            style={
              gen.kind === "audio"
                ? { height: 168, background: done ? gen.grad : "var(--vg-surface)" }
                : { aspectRatio: `${ratio}`, background: done ? gen.grad : "var(--vg-surface)" }
            }
          >
            {!done && <div className="shimmer absolute inset-0" />}
            <AnimatePresence>
              {!done && (
                <motion.div exit={{ opacity: 0 }} className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-ink">
                  <Logo size={48} animate />
                  <div className="text-[12.5px] text-ink2">{stage}</div>
                  <div className="h-1 w-40 overflow-hidden rounded-full bg-line2">
                    <motion.div
                      className="h-full"
                      style={{ background: "var(--color-accent)" }}
                      animate={{ width: `${pct}%` }}
                      transition={{ ease: "easeOut" }}
                    />
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
                {/* Behind the file, not instead of it. This screen exists to show
                    the thing that was just paid for and it drew the gradient and
                    stopped — a coloured rectangle captioned "sample", on the one
                    page where the output is the entire point. `contain`, because
                    the stored w/h is the aspect that was *asked* for and the
                    provider is entitled to answer at its own: cropping a 864×496
                    clip into a 16:9 box loses a strip of what was bought. */}
                <div className="absolute inset-0" style={{ background: gen.grad }} />
                <GenerationMedia gen={gen} fit="contain" controls />
                {gen.kind === "audio" && !gen.outputUrl && (
                  // Bars only where there is no file to play — a demo generation.
                  // A real clip gets an <audio> element from GenerationMedia.
                  <div className="absolute inset-0 flex items-center justify-center gap-[3px] px-8">
                    {Array.from({ length: 32 }, (_, k) => (
                      <span
                        key={k}
                        className="w-[3px] rounded-full bg-bg/45"
                        style={{ height: `${18 + Math.abs(Math.sin(k * 0.9)) * 54}%` }}
                      />
                    ))}
                  </div>
                )}
                {/* "Sample" is a claim about a placeholder. Saying it over a real
                    generation tells the customer their own file is a mock-up. */}
                {!gen.outputUrl && (
                  <div className="absolute start-2 top-2 rounded-full bg-bg/55 px-2 py-0.5 text-[10px] text-ink backdrop-blur-sm">
                    {t("r_sample")}
                  </div>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Meta and actions become the second column at md, so the media keeps
          the width instead of being squeezed above a stack of buttons. */}
        <div className="md:mt-0">
          <div className="mt-4 flex items-center gap-2 text-[12px] text-ink3">
            <span className="rounded-full bg-card2 px-2.5 py-1 text-ink2">{gen.name}</span>
            <span>·</span>
            <span>{gen.vendor}</span>
          </div>
          {gen.prompt && <p className="ltr mt-2 line-clamp-2 text-[12.5px] text-ink2">{gen.prompt}</p>}

          <div className="mt-5 grid grid-cols-3 gap-2.5">
            <ActionBtn icon={<DownloadSimple size={20} />} label={t("r_download")} onClick={download} disabled={!done || !gen.outputUrl} />
            <ActionBtn icon={<ArrowsClockwise size={20} />} label={t("r_regen")} onClick={onRegenerate} disabled={!done} />
            {gen.kind === "image" ? (
              // Disabled without a file: "to video" carries this image into the
              // video model as its opening frame, and there is nothing to carry
              // until one exists.
              <ActionBtn
                icon={<FilmSlate size={20} />}
                label={t("r_to_video")}
                onClick={onToVideo}
                disabled={!done || !gen.outputUrl}
                highlight
              />
            ) : (
              <ActionBtn icon={<ShareNetwork size={20} />} label={t("r_share")} onClick={() => {}} disabled={!done} />
            )}
          </div>
        </div>
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
