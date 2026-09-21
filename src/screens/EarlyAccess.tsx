"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OAuthFailureNotice } from "../components/OAuthFailureNotice";
import { ArrowRight } from "@phosphor-icons/react";
import { BRAND } from "../data/brand";
import { Wordmark } from "../components/brandMarks";
import { useI18n, type TKey } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
import { useAppServices } from "../runtime/AppServices";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "../runtime/providers/authActions";

/* What a visitor who is not signed in sees while `early_access` is on, on every
   route the app layout serves.

   The code is checked here before anyone is sent on, because a page that
   waves every string through reads as accepting it — and on the phone route
   the refusal would only come after an SMS had been sent. The check is a hint,
   not the gate: signup checks the code again inside the transaction that
   creates the account. It answers only yes or no, and is limited per IP, so it
   cannot be used to find codes by guessing.

   The legal pages stay one click away. They live outside the app layout, so the
   gate never covers them, and eNamad's reviewer has to be able to reach them
   from the front page.

   Drawn as a holding page rather than as the sign-in screen it borrowed from:
   the mark, the word, the field, and the brand's light behind all three. It is
   the first thing anyone sees of this product and for most of them it is the
   only thing, so it is composed rather than assembled — but nothing functional
   left with the redesign. The code is still checked before anyone is sent on,
   the refusal is still said under the field, an account that already exists
   still has a way in, and the legal row is still there for the reviewer who
   has to find it. */

const LEGAL: { label: TKey; href: string }[] = [
  { label: "lp_footer_terms", href: "/terms" },
  { label: "lp_footer_privacy", href: "/privacy" },
  { label: "lp_footer_refund", href: "/coins" },
  { label: "lp_footer_company", href: "/about" },
  { label: "lp_footer_contact", href: "/contact" },
];

export default function EarlyAccess() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const services = useAppServices();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);

  const submit = async () => {
    const trimmed = code.trim();
    setFailure(null);
    setChecking(true);
    try {
      if (await services.auth.checkInvite(trimmed)) {
        router.push(`${SIGN_UP_PATH}?invite=${encodeURIComponent(trimmed)}`);
        return;
      }
      setFailure("ea_invalid");
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === "rate_limited"
          ? "auth_err_rate_limited"
          : error instanceof ApiError && error.code === "validation_failed"
            ? "ea_invalid"
            : "auth_err_generic",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="vg-soon vg-grain relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-14">
      {/* A social sign-in refused by the invite gate lands back here. */}
      <OAuthFailureNotice />

      <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center text-center">
        <span style={{ color: "var(--vg-text)" }}>
          <Wordmark height={52} title={BRAND.name} />
        </span>

        {/* Tracked out only in Latin. Persian letters join, and spacing them
            breaks the joins — «ب ه ز و د ی» is not a styled word, it is a
            broken one. */}
        <h1
          className={`mt-9 text-[clamp(2.1rem,7.5vw,3.1rem)] font-extrabold leading-[1.15] ${lang === "en" ? "tracking-[0.2em]" : ""}`}
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          {t("ea_soon")}
        </h1>

        <p
          className={`mt-3 text-[13.5px] font-semibold ${lang === "en" ? "tracking-[0.28em]" : "tracking-normal"}`}
          style={{ color: "var(--vg-primary-soft)" }}
        >
          {t("ea_limited")}
        </p>

        <form
          className="mt-8 w-full max-w-[420px]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="relative">
            <input
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setFailure(null);
              }}
              aria-label={t("auth_invite_label")}
              aria-invalid={failure ? true : undefined}
              aria-describedby={failure ? "ea-error" : undefined}
              placeholder="****-****"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              dir="ltr"
              required
              /* Centred and tracked out, so an eight-character code reads as
                 the shape on the card it was sent on rather than as a word. */
              className="vg-ease h-[52px] w-full rounded-full bg-transparent text-center text-[15px] font-semibold tracking-[0.3em] outline-none"
              style={{
                border: `1px solid ${failure ? "var(--vg-danger)" : "var(--vg-primary)"}`,
                color: "var(--vg-text)",
                paddingInline: "3.25rem",
              }}
            />
            {/* The form submits on Enter, which is what a phone keyboard's Go
                key does — but a field with no visible way on is a field people
                stare at. Shown once there is something to send. */}
            {code.trim() !== "" && (
              <button
                type="submit"
                disabled={checking}
                aria-label={t("ea_submit")}
                title={t("ea_submit")}
                className="vg-ease absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full disabled:opacity-50"
                style={{ insetInlineEnd: 7, background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
              >
                <ArrowRight size={16} weight="bold" className="rtl:-scale-x-100" />
              </button>
            )}
          </div>

          <p
            id="ea-error"
            role="alert"
            className="mt-3 min-h-[1.25rem] text-[12.5px] leading-[1.7]"
            style={{ color: failure ? "var(--vg-danger)" : "transparent" }}
          >
            {failure ? t(failure) : checking ? t("ea_checking") : "\u00a0"}
          </p>
        </form>

        <p className={`mt-1 text-[11.5px] ${lang === "en" ? "tracking-[0.22em]" : ""}`} style={{ color: "var(--vg-text-muted)" }}>
          {t("ea_code_required")}
        </p>
        <p className="vg-numeric mt-3 text-[11px] tracking-[0.18em]" dir="ltr" style={{ color: "var(--vg-text-faint)" }}>
          {BRAND.domain}
        </p>
      </div>

      {/* Quiet, under everything, and not in the mockup — but an account that
          already exists needs a way in, and the legal row is what eNamad's
          reviewer has to be able to reach from the front page. */}
      <div className="relative z-10 mt-12 flex flex-col items-center gap-4 text-[12px]">
        <button
          type="button"
          className="vg-ease hover:text-[color:var(--vg-text)]"
          style={{ color: "var(--vg-text-muted)" }}
          onClick={() => router.push(SIGN_IN_PATH)}
        >
          {t("auth_to_signin")}
        </button>
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[11.5px]">
          {LEGAL.map(({ label, href }) => (
            <a
              key={href}
              href={href}
              className="vg-ease hover:text-[color:var(--vg-text-secondary)]"
              style={{ color: "var(--vg-text-faint)" }}
            >
              {t(label)}
            </a>
          ))}
        </nav>
      </div>
    </main>
  );
}
