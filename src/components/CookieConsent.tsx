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
    <div
      role="dialog"
      aria-label="کوکی‌ها"
      className="fixed inset-x-0 bottom-0 z-50 mx-auto mb-3 w-[calc(100%-1.5rem)] max-w-[520px] rounded-2xl p-3.5 shadow-lg"
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
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
