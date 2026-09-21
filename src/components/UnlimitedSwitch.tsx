"use client";

import { useI18n } from "../lib/i18n";
import { useAccess } from "../lib/access";
import { unlimitedFit } from "../lib/unlimited";
import type { Variant } from "../data/models";

/* ---------------------------------------------------------------------------
   The switch between the two pipes a model can be served through.

   Metered is quick and bills per image. The flat-fee one bills nothing and
   drops into a slower queue past a daily cap. Same model either way — the
   customer is choosing what to spend, time or coins, not which product to buy.

   Which is why this is a switch and not a second entry in the model picker:
   two catalogue rows called "Nano Banana Pro" would make somebody choose
   between things they cannot tell apart.
   --------------------------------------------------------------------------- */

export function UnlimitedSwitch({
  variant,
  input,
  on,
  onChange,
}: {
  variant: Variant;
  input: Record<string, string | number | boolean>;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  const { t } = useI18n();
  const { tier } = useAccess();
  const fit = unlimitedFit(variant, input, tier);

  // No pipe on this variant — the row is not a thing that could be here.
  if (!fit) return null;

  // A plan below the grant's tier gets nothing rather than a disabled switch:
  // the setting case is something the customer can fix from this dock, and a
  // plan is not. Offering the upgrade belongs on the row that sells plans, not
  // on a chip in the toolbar.
  if (!fit.available && fit.reason === "tier") return null;

  const blocked = !fit.available;

  return (
    /* A chip, the same object as everything else in the dock.
       It was a bordered box with its own height and padding, standing outside
       the control row — which made the row read as "four chips and a widget".
       It is a control like the others and now looks like one. */
    <label
      title={blocked ? t("unl_blocked") : undefined}
      className="flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-xl px-3 text-[13px] font-semibold transition-colors"
      style={{
        background: on && !blocked ? "var(--vg-accent-a20)" : "var(--vg-surface-overlay)",
        color: on && !blocked ? "var(--vg-accent)" : "var(--vg-text-muted)",
        opacity: blocked ? 0.55 : 1,
      }}
    >
      {/* A real checkbox under the paint: it is what a keyboard reaches, what a
          screen reader announces, and what a form would submit. The track and
          knob are decoration over it. */}
      <input
        type="checkbox"
        className="sr-only"
        checked={on && !blocked}
        disabled={blocked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className="relative inline-flex h-[18px] w-[32px] shrink-0 rounded-full transition-colors"
        style={{ background: on && !blocked ? "var(--vg-accent)" : "var(--vg-surface-overlay)" }}
      >
        <span
          className="absolute top-[2px] size-[14px] rounded-full transition-[inset-inline-start]"
          style={{
            // Logical, so the knob travels toward the reading edge in both
            // directions rather than always to the visual right.
            insetInlineStart: on && !blocked ? "16px" : "2px",
            background: on && !blocked ? "var(--vg-text-on-accent, #05060a)" : "var(--vg-text-muted)",
          }}
        />
      </span>

      {/* One word, and the reason only when there is one.
          It said "free but slower — up to 50 images a day", which told the
          customer three things that are ours and not theirs: that our own
          fulfilment is the slow one, that we ration it, and by how much. None of
          that helps somebody decide; it just apologises for the offer while
          making it. The daily cap stays in the contract because the server
          enforces it — it simply is not copy.

          "Not at this quality" survives because it is the one thing the customer
          needs: without it the switch sits there looking available and the coins
          come off anyway. */}
      <span className="whitespace-nowrap">{t("unl_title")}</span>
      {/* The reason rides on the chip's own title rather than a second line:
          the row is one height now, and a blocked chip that grows is the one
          that breaks it. */}
      {blocked && <span className="sr-only">{t("unl_blocked")}</span>}
    </label>
  );
}
