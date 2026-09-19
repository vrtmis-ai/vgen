import { useEffect, useRef, useState } from "react";
import { Trash } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { generationErrorAction, jobFailureMessage, type GenerationRefusal } from "../features/generation/validation";
import { Note, NoteAction } from "./ui/note";
import { useI18n } from "../lib/i18n";

/**
 * A generation that is still being made, drawn where it was asked for.
 *
 * Black with the brand's light moving through it (`.vg-gen-field`), filling
 * its positioned parent. Four surfaces drew this separately — the video
 * canvas in both views, the image wall, the model page — and they had already
 * drifted: one list still used the flat 45% scrim the field replaced.
 *
 * The bar only appears when there is a number to put in it. Nothing on the
 * server reports progress, so `progress` is absent on every real job, and a
 * bar that says ۰٪ for the whole of a two-minute video tells somebody it has
 * stalled. The moving field already says "working"; the words say what.
 */
export function RunningVeil({ gen }: { gen: Generation }) {
  const { t, n } = useI18n();
  const percent = gen.progress == null ? null : Math.round(gen.progress);
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="vg-gen-field" />
      <div className="relative w-2/3 max-w-[180px] text-center">
        {percent !== null && (
          /* A progressbar, not a div that happens to be N% wide — a screen
             reader gets a range and a value rather than a stray number. */
          <div
            role="progressbar"
            aria-label={t("r_making")}
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuetext={`${n(percent)}٪`}
            className="mb-2 h-1 w-full overflow-hidden rounded-full"
            style={{ background: "rgb(255 255 255 / 0.12)" }}
          >
            <div
              className="h-full transition-[width] duration-200 ease-out"
              style={{ width: `${percent}%`, background: "var(--vg-primary)" }}
            />
          </div>
        )}
        <p className="text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          {t("r_making")}…{percent !== null && <span className="vg-numeric"> {n(percent)}٪</span>}
        </p>
      </div>
    </div>
  );
}

/**
 * A generation that was refused, drawn where it was asked for.
 *
 * The studios used to leave every failure to کارهای من. The image wall
 * filtered them out, the video canvas drew an empty gradient card, and the
 * audio list drew a clip that did not exist. That held up only while «بساز»
 * sent the browser to کارهای من, and it no longer does. So the reason is said
 * here, in the words `jobFailureMessage` already chose for each code — each of
 * them also says the coins came back — with a way to clear it.
 *
 * Said in a `Note`, which is the shape every failure in the app now takes: the
 * status word in bold, the reason after it, and the one control that applies
 * pinned to the end. On a tile that control is the bin, because a job that
 * produced nothing has nothing else left to do with it.
 *
 * The remove button means this must never sit inside another button. A card
 * that opens something keeps this as a sibling, the way کارهای من does.
 */
export function FailedVeil({
  gen,
  onRemove,
  lines = 3,
  framed = false,
}: {
  gen: Generation;
  onRemove?: (() => void) | undefined;
  lines?: number;
  /** A hairline of its own, for a wall whose tiles have no border to lean on. */
  framed?: boolean;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const reason = jobFailureMessage(gen.error?.code);
  return (
    <div
      className="absolute inset-0 flex flex-col justify-end p-2"
      style={{ background: "var(--vg-surface)", boxShadow: framed ? "inset 0 0 0 1px var(--vg-border-subtle)" : undefined }}
    >
      <Note
        type="error"
        size="small"
        fill
        align="start"
        /* On a tile too short for a reason (`lines: 0`) the status word is all
           there is, so it goes in the body and the icon takes the label's
           place — a bold «انجام نشد:» with nothing after the colon is a
           sentence cut in half. */
        label={lines > 0 ? t("gal_failed") : true}
        action={
          onRemove && (
            <button
              type="button"
              onClick={() => {
                setBusy(true);
                onRemove();
              }}
              disabled={busy}
              aria-label={`${t("gal_remove")} — ${gen.prompt.trim().slice(0, 40) || gen.name}`}
              title={t("gal_remove")}
              className="-me-0.5 grid size-6 shrink-0 place-items-center rounded-md transition-opacity disabled:opacity-40"
              style={{ color: "var(--vg-text-muted)" }}
            >
              <Trash size={13} />
            </button>
          )
        }
      >
        {lines > 0 ? (
          // `title` carries the whole sentence where a short tile clamps it.
          <span
            title={reason}
            className="block overflow-hidden"
            style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }}
          >
            {reason}
          </span>
        ) : (
          <span title={reason} className="font-semibold">
            {t("gal_failed")}
          </span>
        )}
      </Note>
    </div>
  );
}

/**
 * A press that never became a job, said above the button that made it.
 *
 * The other half of a failure, and the half that had nowhere to go: a refusal
 * arrives before there is any card to draw it on. It used to replace the whole
 * studio with a 503, then became a bare red line, and is now the same notice as
 * every other failure — with the button its own sentence keeps asking for,
 * where there is one to offer.
 *
 * Above the button rather than below it, which is where it started. Every dock
 * in this product is pinned to the floor of its panel, so a box added under the
 * button pushes the button up — measured at 52px in the image dock: the thing
 * you just pressed slides out from under the pointer, and the answer lands in
 * the last strip of the screen, which is the part of it nobody is looking at
 * after a press. Added above, the panel grows upward instead: the button does
 * not move, and the sentence appears inside the dock the eye is already on.
 *
 * Two more things carry it the rest of the way. `.vg-notice-in` gives it a
 * 160ms rise, because appearing in place is not something peripheral vision
 * reports. And if it is off-screen anyway — a long form on a short window —
 * it scrolls itself into view, once, without moving anything that is already
 * visible (`block: "nearest"`).
 */
export function SubmitRefusalNote({
  refusal,
  onAction,
  className,
}: {
  refusal: GenerationRefusal;
  onAction?: ((target: "wallet" | "plans") => void) | undefined;
  className?: string;
}) {
  const action = generationErrorAction(refusal.code);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = box.current;
    // jsdom has no scrollIntoView, and a window with no layout has no answer
    // to "is this visible" worth acting on.
    if (!element?.scrollIntoView) return;
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    element.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [refusal]);

  return (
    <div ref={box} className={className}>
      <Note
        type="error"
        size="small"
        fill
        align="start"
        role="status"
        className="vg-notice-in"
        action={action && onAction ? <NoteAction onClick={() => onAction(action.target)}>{action.label}</NoteAction> : undefined}
      >
        {refusal.message}
      </Note>
    </div>
  );
}
