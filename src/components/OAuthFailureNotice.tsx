"use client";

import { useEffect, useState } from "react";

import { useI18n, type TKey } from "../lib/i18n";

/**
 * Says why a social sign-in did not work.
 *
 * A failed Google or Microsoft sign-in cannot come back as a rejected promise:
 * the browser is mid-redirect and there is no call left to reject. It comes
 * back as `?auth=<code>` on the landing page instead, and until now nothing
 * read it — so somebody who pressed "continue with Google", got bounced by the
 * invite gate, and landed back on the marketing page had no way to know that
 * anything had been refused, or that a phone number would have worked.
 *
 * The codes are `docs/API.md`'s. `failed` is the CSRF-state mismatch and is
 * deliberately vague to the user: it is either a stale tab or someone else's
 * forged link, and neither is worth explaining on a landing page.
 */
const CALLBACK_MESSAGES: Readonly<Record<string, TKey>> = {
  oauth_failed: "auth_cb_oauth_failed",
  failed: "auth_cb_failed",
  invite_required: "auth_cb_invite_required",
  invite_invalid: "auth_cb_invite_invalid",
  account_suspended: "auth_cb_account_suspended",
};

export function OAuthFailureNotice() {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);

  /* Read once on mount from `window` rather than through `useSearchParams`,
     which would put a prerender bailout on every route under this layout for a
     value that only ever exists on a client-side redirect. Stripping it in the
     same pass means a refresh does not re-accuse a provider that failed once. */
  useEffect(() => {
    const url = new URL(window.location.href);
    const found = url.searchParams.get("auth");
    if (!found) return;
    setCode(found);
    url.searchParams.delete("auth");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (code == null) return null;
  const message = CALLBACK_MESSAGES[code] ?? "auth_cb_oauth_failed";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-4">
      <div
        role="alert"
        className="pointer-events-auto flex w-full max-w-[520px] items-start gap-3 rounded-card px-4 py-3.5 shadow-lg"
        style={{
          background: "var(--vg-surface-raised)",
          border: "1px solid var(--vg-border)",
          backdropFilter: "blur(16px)",
        }}
      >
        <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: "var(--vg-danger, #ff5a6a)" }} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold" style={{ color: "var(--vg-text)" }}>
            {t("auth_cb_title")}
          </span>
          <span className="mt-1 block text-[12px] leading-[1.8]" style={{ color: "var(--vg-text-muted)" }}>
            {t(message)}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setCode(null)}
          aria-label={t("auth_cb_dismiss")}
          className="vg-ease shrink-0 rounded-pill px-2 py-1 text-[11px] font-semibold"
          style={{ color: "var(--vg-text-faint)" }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
