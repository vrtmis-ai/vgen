import type { MouseEvent, ReactNode } from "react";
import { ArrowsClockwise, ArrowsOut, DownloadSimple, FilmSlate } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { useDownloadOutput } from "../features/generation/useDownloadOutput";
import { cn } from "../lib/utils";

/**
 * What you can do with a finished generation, without opening it.
 *
 * The image wall had a stack like this and nothing else did — not the video
 * canvas, not the model page, not کارهای من — so everywhere but one screen the
 * only way to download something was to open it, act, and come back. Two of
 * that stack's four buttons were also wired to `() => {}`: a heart with no
 * endpoint behind it and a "regenerate" that regenerated nothing.
 *
 * So: one rail, shared, and only the actions that exist. The heart is gone
 * rather than moved — there is no likes API, and a button that does nothing
 * teaches people not to press the ones that do.
 *
 * Each button renders only when its caller passed a handler, and download
 * appears only on a generation with a file. The rail must never sit inside a
 * button; on a card that opens something it is a sibling, as the remove and
 * cancel controls are.
 */
export function OutputActions({
  gen,
  onOpen,
  onRegenerate,
  onToVideo,
  inline = false,
  className,
}: {
  gen: Generation;
  onOpen?: (() => void) | undefined;
  onRegenerate?: (() => void) | undefined;
  /** Hand this frame to a video model as its opening shot. Stills only. */
  onToVideo?: (() => void) | undefined;
  /** In a row rather than over a picture: always visible, laid out across. */
  inline?: boolean;
  className?: string;
}) {
  const download = useDownloadOutput();
  const of = gen.prompt.trim().slice(0, 40) || gen.name;

  const actions: { Icon: typeof ArrowsOut; label: string; on: () => void }[] = [];
  if (onOpen) actions.push({ Icon: ArrowsOut, label: "بزرگ کن", on: onOpen });
  if (gen.outputUrl && gen.jobId) actions.push({ Icon: DownloadSimple, label: "دانلود", on: () => download(gen) });
  if (onRegenerate) actions.push({ Icon: ArrowsClockwise, label: "دوباره بساز", on: onRegenerate });
  if (onToVideo && gen.kind === "image") actions.push({ Icon: FilmSlate, label: "به ویدیو", on: onToVideo });
  if (actions.length === 0) return null;

  /* `stopPropagation`, because the rail usually overlays a card that opens the
     result and a press on the bin is not a press on the card. */
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation();
    fn();
  };

  return (
    <div
      className={cn(
        inline
          ? "flex flex-row gap-1"
          : // Hidden until the pointer arrives, and until focus does — a stack
            // that only answers a mouse is a stack a keyboard cannot reach.
            "absolute top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        className,
      )}
      style={inline ? undefined : { insetInlineEnd: "0.375rem" }}
    >
      {actions.map(({ Icon, label, on }) => (
        <button
          key={label}
          type="button"
          // The visible tooltip is the short verb; the name carries the target,
          // or a wall of forty frames is forty buttons all called "دانلود".
          aria-label={`${label} — ${of}`}
          title={label}
          onClick={stop(on)}
          className="grid size-7 place-items-center rounded-lg backdrop-blur-sm transition-colors"
          style={{ background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

/** A card that shows this rail needs `group` and `relative` on its own box. */
export function OutputActionsHost({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("group relative", className)}>{children}</div>;
}
