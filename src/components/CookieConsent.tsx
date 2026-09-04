"use client";

import { useState } from "react";
import Link from "next/link";
import { CONSENT_COOKIE, CONSENT_MAX_AGE_SECONDS, parseConsent, serializeConsent } from "../lib/cookies";

/**
 * The cookie notice.
 *
 * **It tells the truth about a product that currently sets only necessary
 * cookies**, which is a shorter and less annoying notice than the one most
 * sites show. There is no tracker, no pixel and no advertising tag here, so
 * there is nothing yet for a visitor to refuse — and a banner that demanded a
 * choice about analytics that do not exist would be theatre.
 *
 * The mechanism is real even so. The choice is stored, versioned, and read by
 * `allows()` — so the day a tracker is added it is off for everyone who has not
 * been asked about it, rather than on for everyone who agreed to something else
 * a year earlier.
 *
 * Rendered from the root layout with the server's reading of the cookie as its
 * initial state. Deciding client-side would flash the banner at every returning
 * visitor for one frame after hydration, which is the single most irritating
 * way to implement this.
 */
export function CookieConsent({ initial }: { initial: string | undefined }) {
  const [decided, setDecided] = useState(() => parseConsent(initial) !== null);

  if (decided) return null;

  const remember = (analytics: boolean) => {
    // Lax, not Strict: a visitor arriving from a link should not be asked
    // again because their answer was withheld on a cross-site navigation.
    document.cookie = `${CONSENT_COOKIE}=${serializeConsent(analytics)};path=/;max-age=${CONSENT_MAX_AGE_SECONDS};samesite=lax`;
    setDecided(true);
  };

  return (
    /* Anchored to the top, at the inline-end corner, and this is the only place
       it can go.

       It used to be a centred card at `bottom-0`, which put it exactly where
       the create dock lives. Measured on a 390px viewport: the dock occupies
       y=678..826 of an 844px screen, the notice covered y=708..832, and
       `elementFromPoint` at the centre of the Generate button returned the
       notice. A visitor's first action on the product was not merely obscured,
       it was unclickable — in both studios — until they dismissed a banner
       about cookies we barely set.

       The bottom is the dock's, on every route and every width, so there is no
       offset that frees it. The top-inline-START corner is the sticky view
       controls. That leaves the top-inline-END corner, which nothing else
       claims. 97px clears the promo bar (44) plus the top bar (45) with room to
       spare, and it is a constant rather than a measurement so the notice never
       moves when the promo bar is dismissed. */
    <div
      role="dialog"
      aria-label="کوکی‌ها"
      className="fixed top-[97px] z-50 w-[calc(100%-1.5rem)] max-w-[380px] rounded-2xl p-3.5 shadow-lg"
      style={{
        insetInlineEnd: "0.75rem",
        background: "var(--vg-surface)",
        border: "1px solid var(--vg-border-subtle)",
      }}
    >
      <p className="text-[12.5px] leading-6" style={{ color: "var(--vg-text)" }}>
        این سایت فقط کوکی‌های ضروری می‌گذارد — برای واردماندن، زبان، و همین انتخاب. هیچ ردیاب و هیچ کوکی تبلیغاتی وجود ندارد.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => remember(false)}
          className="h-9 rounded-lg px-3.5 text-[12.5px] font-bold"
          style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
        >
          باشه
        </button>
        {/* No "reject" button, because there is nothing to reject. Offering one
            that changed nothing would be a lie told with a control. */}
        <Link
          href="/cookies"
          className="h-9 rounded-lg px-3 text-[12.5px] leading-9 underline-offset-2 hover:underline"
          style={{ color: "var(--vg-text-muted)" }}
        >
          جزئیات
        </Link>
      </div>
    </div>
  );
}
