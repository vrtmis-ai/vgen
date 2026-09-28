"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onConsentChange, saveConsent } from "../lib/analytics";
import { parseConsent } from "../lib/cookies";

/**
 * The cookie notice.
 *
 * The essential cookies are not a question, so the only choice offered is the
 * one that is real: whether PostHog may run. Both answers are equally easy and
 * equally prominent, and neither is the default — until one is given, analytics
 * stay off (see `startAnalytics`).
 *
 * The choice is stored versioned and read by `allows()`, so a category added
 * later starts off for everyone who has not been asked about it.
 *
 * Rendered from the root layout with the server's reading of the cookie as its
 * initial state. Deciding client-side would flash the banner at every returning
 * visitor for one frame after hydration, which is the single most irritating
 * way to implement this.
 */
export function CookieConsent({ initial }: { initial: string | undefined }) {
  const [decided, setDecided] = useState(() => parseConsent(initial) !== null);

  // The layout outlives every navigation, so a choice made on /cookies has to
  // reach a banner that is still mounted here.
  useEffect(() => onConsentChange(() => setDecided(true)), []);

  if (decided) return null;

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
        کوکی‌های ضروری (ورود، زبان، و همین انتخاب) در هر حال هست. اگر اجازه بدهی، برای اینکه بفهمیم کجای سایت گیج‌کننده یا کند است از ابزار
        آمار PostHog (سرورهای اروپا) هم استفاده می‌کنیم: صفحه‌هایی که می‌بینی و کلیک‌هایت، همراه با شناسه‌ی حسابت — نه ایمیل و نه متن
        پرامپت‌هایت. تبلیغاتی در کار نیست.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {[
          { label: "قبول می‌کنم", analytics: true },
          { label: "فقط ضروری‌ها", analytics: false },
        ].map(({ label, analytics }) => (
          <button
            key={label}
            onClick={() => saveConsent(analytics)}
            className="h-9 rounded-lg px-3.5 text-[12.5px] font-bold"
            style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
          >
            {label}
          </button>
        ))}
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
