import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, DownloadSimple, ArrowsClockwise, FilmSlate, ShareNetwork, Trash } from "@phosphor-icons/react";
import { displayAspect, isUnfinished, type Generation } from "../lib/gallery";
import { Logo } from "../components/chrome";
import { GenerationMedia } from "../components/GenerationMedia";
import { jobFailureMessage } from "../features/generation/validation";
import { Note } from "../components/ui/note";
import { useI18n, type TKey } from "../lib/i18n";
import { useAppServices } from "../runtime/AppServices";

const STAGE_KEYS: TKey[] = ["r_stage1", "r_stage2", "r_stage3", "r_stage4"];

export default function Result({
  gen,
  instant,
  onBack,
  onRegenerate,
  onToVideo,
  onRemove,
  onDone,
}: {
  gen: Generation;
  instant?: boolean;
  onBack: () => void;
  onRegenerate: () => void;
  onToVideo: () => void;
  /** Offered on a refused generation only — see the button at the foot. */
  onRemove: () => void;
  onDone?: () => void;
}) {
  const { t, n } = useI18n();
  const services = useAppServices();
  /* A refusal is an outcome, not a pause. Before this branch existed the screen
     had two states and a failed job fell into the one with the spinner, so the
     page kept promising a file the provider had already declined to make — for
     as long as the tab stayed open. */
  const failed = isUnfinished(gen.status);
  /* Read, not simulated.
     This screen used to run its own interval, which was fine while a job could
     only be watched from here. It can now also be watched in the studio canvas
     it started in, and two independent counters drift — the one you are not
     looking at keeps ticking after the job is done. App drives the single
     ticker and writes `progress` onto the generation; this reads it.

     `instant` still means "opened from history", where there is nothing to
     watch and the answer is simply 100. */
  const pct = failed ? 0 : instant ? 100 : Math.round(gen.progress ?? (gen.status === "done" ? 100 : 0));
  const done = !failed && (gen.status === "done" || pct >= 100);
  const firedDone = useRef(false);

  useEffect(() => {
    if (done && !instant && !firedDone.current) {
      firedDone.current = true;
      onDone?.();
    }
  }, [done, instant, onDone]);

  const stage = t(STAGE_KEYS[Math.min(STAGE_KEYS.length - 1, Math.floor((pct / 100) * STAGE_KEYS.length))]!);
  // The shape that arrived, not the one that was ordered — see `displayAspect`.
  const shape = displayAspect(gen);
  const ratio = shape.w / shape.h;

  /* Through the API, not straight at the file.

     This used to point an `<a download>` at `gen.outputUrl` and hope. The
     `download` attribute is honoured only for same-origin URLs, and an output
     URL is signed against the object store's host — `127.0.0.1:9000` locally,
     `files.deev.ir` in production — so it was always ignored and the browser
     did the other thing it knows how to do with a picture: showed it, in a tab,
     which is not what the button says.

     The route answers 302 to the same file signed to arrive as an attachment.
     The name and extension are decided there too, from the stored mime type,
     because the server is the only side that knows what the bytes are. */
  const download = () => {
    if (!gen.jobId || !gen.outputUrl) return;
    const el = document.createElement("a");
    el.href = services.generation.downloadUrl(gen.jobId);
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
        <div className="text-[15px] font-medium">{failed ? t("r_failed") : done ? t("r_result") : t("r_making")}</div>
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
            {!done && !failed && <div className="shimmer absolute inset-0" />}
            {/* The refusal, where the picture would have been. Sized and placed
                like the progress block it replaces, because it answers the same
                question — "what is happening to my generation" — with the one
                fact that block could not carry. */}
            {failed && (
              <div className="absolute inset-0 flex items-center justify-center px-6">
                <Note
                  type={gen.status === "cancelled" ? "default" : "error"}
                  size="large"
                  fill
                  align="start"
                  label={gen.status === "cancelled" ? t("gal_cancelled") : t("gal_failed")}
                  className="max-w-[440px]"
                >
                  {gen.status === "cancelled" ? t("gal_cancelled_note") : jobFailureMessage(gen.error?.code)}
                </Note>
              </div>
            )}
            <AnimatePresence>
              {!done && !failed && (
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
                    page where the output is the entire point.

                    `contain` still, because a provider is entitled to answer at
                    its own aspect and cropping a 864×496 clip into a 16:9 box
                    loses a strip of what was bought. It no longer letterboxes:
                    the box above is now built from the file's measured size, so
                    there is nothing for the gradient to show through. It stays
                    `contain` as the guard for the case where those two ever
                    disagree again — a pre-measurement row, say. */}
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
            {/* Enabled on failure too, and it is the only one that is: a refused
                generation refunds, so trying again is both possible and the
                obvious next move. Download and "to video" need a file. */}
            <ActionBtn icon={<ArrowsClockwise size={20} />} label={t("r_regen")} onClick={onRegenerate} disabled={!done && !failed} />
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

          {/* A refusal is the one outcome with nothing to keep.
              No file was made and the hold was released, so the row is a note
              saying a provider said no — worth seeing once, and then worth
              being able to clear. Nothing like it is offered on a finished
              generation: that is the thing the customer paid for. */}
          {failed && (
            <button
              onClick={onRemove}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px]"
              style={{ color: "var(--vg-text-muted)" }}
            >
              <Trash size={14} />
              {t("gal_remove")}
            </button>
          )}
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
