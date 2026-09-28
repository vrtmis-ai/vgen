"use client";

import { useEffect, useState } from "react";
import { onConsentChange, saveConsent } from "../lib/analytics";
import { parseConsent } from "../lib/cookies";

/**
 * The analytics choice, changeable after the notice has gone.
 *
 * Withdrawing has to be as easy as giving, and the notice only shows once — so
 * the cookie policy carries the same two answers, kept in step with the notice
 * through `onConsentChange`.
 */
export function ConsentChoice({ initial }: { initial: string | undefined }) {
  const [consent, setConsent] = useState(() => parseConsent(initial));
  useEffect(() => onConsentChange(setConsent), []);

  const status =
    consent === null ? "هنوز انتخاب نکرده‌ای؛ تا آن موقع آمار خاموش است." : consent.analytics ? "آمار روشن است." : "آمار خاموش است.";

  return (
    <div>
      <p className="text-[12.5px] leading-7" style={{ color: "var(--vg-text-muted)" }} role="status">
        {status}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {[
          { label: "اجازه می‌دهم", analytics: true },
          { label: "فقط ضروری‌ها", analytics: false },
        ].map(({ label, analytics }) => (
          <button
            key={label}
            onClick={() => saveConsent(analytics)}
            aria-pressed={consent?.analytics === analytics}
            className="h-9 rounded-lg px-3.5 text-[12.5px] font-bold"
            style={{
              background: consent?.analytics === analytics ? "var(--vg-primary-a18)" : "transparent",
              color: "var(--vg-primary-soft)",
              border: "1px solid var(--vg-border-subtle)",
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
