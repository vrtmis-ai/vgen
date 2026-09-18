import { useState } from "react";
import { Trash, WarningCircle } from "@phosphor-icons/react";
import type { Generation } from "../lib/gallery";
import { jobFailureMessage } from "../features/generation/validation";
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
      className="absolute inset-0 flex flex-col gap-2 p-2.5"
      style={{ background: "var(--vg-surface)", boxShadow: framed ? "inset 0 0 0 1px var(--vg-border-subtle)" : undefined }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
        >
          <WarningCircle size={12} weight="bold" />
          {t("gal_failed")}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={() => {
              setBusy(true);
              onRemove();
            }}
            disabled={busy}
            aria-label={`${t("gal_remove")} — ${gen.prompt.trim().slice(0, 40) || gen.name}`}
            title={t("gal_remove")}
            className="grid size-7 shrink-0 place-items-center rounded-lg transition-opacity disabled:opacity-40"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
          >
            <Trash size={13} />
          </button>
        )}
      </div>
      {lines > 0 && (
        // `title` carries the whole sentence where a short tile clamps it.
        <p
          title={reason}
          className="mt-auto overflow-hidden text-[11.5px] leading-snug"
          style={{ color: "var(--vg-text-secondary)", display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines }}
        >
          {reason}
        </p>
      )}
    </div>
  );
}
