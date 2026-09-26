"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { OAuthFailureNotice } from "../components/OAuthFailureNotice";
import { BRAND } from "../data/brand";
import { Wordmark } from "../components/brandMarks";
import { readContact } from "../lib/contact";
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

/**
 * The wall of light behind the gate.
 *
 * Straight from the reference the design sent, with its own curve: the height
 * of each bar is the distance of that bar from the middle, raised to 1.2, so
 * the row dips in the centre and the type has somewhere dark to sit. Fifteen
 * of them, breathing on a tenth-of-a-second stagger.
 *
 * The count is fixed rather than responsive because the curve is what the
 * shape *is* — recalculating it for a phone would give a different picture on
 * a phone, and the bars simply get narrower instead.
 */
/**
 * How many are already waiting, above the mark.
 *
 * Fetched rather than passed in, and silent when it cannot be: the route is
 * not written yet, so a deployment without it shows nothing here instead of an
 * error or a zero. Nothing else on the page depends on it.
 *
 * **The number shown is the count plus `WAITLIST_FLOOR`.** That is the owner's
 * decision and it is written here in one place rather than folded into the
 * copy, so anybody reading this knows the figure on screen is not the figure
 * in the table.
 */
const WAITLIST_FLOOR = 1000;

function WaitingCount() {
  const { t, n } = useI18n();
  const services = useAppServices();
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void services.auth
      .waitlistCount()
      .then((value) => {
        if (live) setCount(value);
      })
      .catch(() => {
        // No route, no strip. See above.
      });
    return () => {
      live = false;
    };
  }, [services]);

  if (count === null) return null;
  return (
    <span
      className="vg-arrive inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] backdrop-blur-sm"
      style={{ background: "var(--vg-glass-light)", color: "var(--vg-text-secondary)", boxShadow: "inset 0 0 0 1px var(--vg-border)" }}
    >
      <span className="size-1.5 rounded-full" style={{ background: "var(--vg-primary)" }} />
      {t("ea_waiting").replace("{n}", n(count + WAITLIST_FLOOR))}
    </span>
  );
}

const BARS = 15;

function SoonBars() {
  return (
    <div className="vg-bars" aria-hidden>
      {Array.from({ length: BARS }, (_, index) => {
        const fromCentre = Math.abs(index / (BARS - 1) - 0.5) * 2;
        const height = 0.3 + 0.7 * Math.pow(fromCentre, 1.2);
        return (
          <span
            key={index}
            style={{ "--vg-bar": height, animationDelay: `${index * 0.1}s`, maxWidth: `${100 / BARS}%` } as CSSProperties}
          />
        );
      })}
    </div>
  );
}

export default function EarlyAccess() {
  const { t, lang } = useI18n();
  const router = useRouter();
  const services = useAppServices();
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);
  /* Two ways in, one field. Somebody with a code types it; somebody without
     asks to be told when there is room. */
  const [queueing, setQueueing] = useState(false);
  const [listed, setListed] = useState(false);

  const submit = async () => {
    const trimmed = code.trim();
    setFailure(null);
    // The button is never dark, so the empty press is answered here.
    if (trimmed === "") {
      setFailure("ea_invalid");
      return;
    }
    setChecking(true);
    try {
      if ((await services.auth.checkInvite(trimmed)).valid) {
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

  const join = async () => {
    const contact = readContact(code);
    setFailure(null);
    // Checked here so an empty box or a stray word never becomes a request —
    // and the demo adapter refuses the same input, so the two agree.
    if (!contact) {
      setFailure("ea_queue_invalid");
      return;
    }
    setChecking(true);
    try {
      await services.auth.joinWaitlist(contact.value);
      setListed(true);
    } catch (error) {
      setFailure(
        error instanceof ApiError && error.code === "rate_limited"
          ? "auth_err_rate_limited"
          : error instanceof ApiError && error.code === "validation_failed"
            ? "ea_queue_invalid"
            : /* They have nothing to wait for — they can sign in, and the way
                 to do that is already at the foot of this page. */
              error instanceof ApiError && error.code === "account_exists"
              ? "ea_queue_has_account"
              : "auth_err_generic",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <main className="vg-soon vg-grain relative flex min-h-[100dvh] flex-col items-center justify-center px-5 py-14">
      <SoonBars />

      {/* A social sign-in refused by the invite gate lands back here. */}
      <OAuthFailureNotice />

      <div className="relative z-10 flex w-full max-w-[560px] flex-col items-center text-center">
        <WaitingCount />

        <span className="vg-arrive mt-6" style={{ color: "var(--vg-text)", "--vg-arrive-step": 1 } as CSSProperties}>
          <Wordmark height={52} title={BRAND.name} />
        </span>

        {/* Tracked out only in Latin. Persian letters join, and spacing them
            breaks the joins — «ب ه ز و د ی» is not a styled word, it is a
            broken one. */}
        <h1
          className={`vg-arrive mt-9 text-[clamp(2.1rem,7.5vw,3.1rem)] font-extrabold leading-[1.15] ${lang === "en" ? "tracking-[0.2em]" : ""}`}
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)", "--vg-arrive-step": 2 } as CSSProperties}
        >
          {t(listed ? "ea_queue_done" : queueing ? "ea_queue_title" : "ea_soon")}
        </h1>

        <p
          className={`vg-arrive mt-3 text-[13.5px] font-semibold ${lang === "en" ? "tracking-[0.28em]" : "tracking-normal"}`}
          style={{ color: "var(--vg-primary-soft)", "--vg-arrive-step": 3 } as CSSProperties}
        >
          {t("ea_limited")}
        </p>

        {listed ? (
          /* The form is gone rather than emptied: there is nothing left to do
             here, and a field still sitting there invites a second go. */
          <div className="mt-8 flex max-w-[420px] flex-col items-center gap-5">
            <p className="text-[13px] leading-[1.9]" style={{ color: "var(--vg-text-secondary)" }}>
              {t("ea_queue_done_note")}
            </p>
            {/* Not a dead end. The code arrives by email, and somebody reading
                this on the tab they left open needs a way to the field without
                reloading the page to find it. */}
            <button
              type="button"
              onClick={() => {
                setListed(false);
                setQueueing(false);
                setCode("");
                setFailure(null);
              }}
              className="vg-ease h-12 rounded-full px-5 text-[15px] hover:bg-white/5"
              style={{ color: "var(--vg-text-secondary)", boxShadow: "inset 0 0 0 1px var(--vg-border)" }}
            >
              {t("ea_have_code")}
            </button>
          </div>
        ) : (
          <form
            className="vg-arrive mt-8 w-full max-w-[420px]"
            style={{ "--vg-arrive-step": 4 } as CSSProperties}
            onSubmit={(event) => {
              event.preventDefault();
              void (queueing ? join() : submit());
            }}
          >
            <div className="relative">
              <input
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  setFailure(null);
                }}
                aria-label={t(queueing ? "ea_queue_placeholder" : "auth_invite_label")}
                aria-invalid={failure ? true : undefined}
                aria-describedby={failure ? "ea-error" : undefined}
                placeholder={queueing ? t("ea_queue_placeholder") : "****-****"}
                autoComplete={queueing ? "email" : "off"}
                autoCapitalize={queueing ? "none" : "characters"}
                spellCheck={false}
                dir="ltr"
                required
                /* Centred and tracked out, so an eight-character code reads as
                 the shape on the card it was sent on rather than as a word. */
                className={`vg-ease h-12 min-w-0 flex-1 rounded-full bg-transparent text-center outline-none ${
                  queueing ? "text-[14px] font-medium" : "text-[15px] font-semibold tracking-[0.3em]"
                }`}
                style={{
                  border: `1px solid ${failure ? "var(--vg-danger)" : "var(--vg-primary)"}`,
                  color: "var(--vg-text)",
                  paddingInline: "1.5rem",
                }}
              />
              {/* Beside the field and always there, rather than an arrow that
                  appeared inside it once something had been typed. The whole
                  point of this page is that there is a way on; a control you
                  have to type to discover is not one. */}
              <button
                type="submit"
                /* Lit even with the field empty. A dark primary button cannot
                   say why it is dark, and on the one page where the only job
                   is "get in", the control for getting in should never look
                   switched off — the press answers instead. Same rule the
                   create docks follow for an empty wallet. */
                disabled={checking}
                /* The landing's CTA, not a second design for the same act:
                   `.vg-gleam` at the same height and padding, with the same
                   halo behind it. That button is the one place this product
                   asks somebody to commit, and this page is the other. */
                className="vg-gleam h-12 shrink-0 px-6 text-base font-bold whitespace-nowrap"
                style={{ boxShadow: "inset 0 0 0 1px var(--vg-surface), 0 0 48px rgb(var(--vg-primary-rgb) / 0.22)" }}
              >
                <span className="text-nowrap">
                  {checking ? t(queueing ? "ea_queue_sending" : "ea_checking") : t(queueing ? "ea_queue_submit" : "ea_submit")}
                </span>
              </button>
            </div>

            <p
              id="ea-error"
              role="alert"
              className="mt-3 min-h-[1.25rem] text-[12.5px] leading-[1.7]"
              style={{ color: failure ? "var(--vg-danger)" : "transparent" }}
            >
              {failure ? t(failure) : checking ? t(queueing ? "ea_queue_sending" : "ea_checking") : "\u00a0"}
            </p>

            {/* Nothing once they are on the list: the note above already says what
                happens next, and «فقط با کد دعوت» under it would be the page
                asking again for the thing it just promised to send. */}
            {!listed && (
              <p className={`mt-1 text-[11.5px] ${lang === "en" ? "tracking-[0.22em]" : ""}`} style={{ color: "var(--vg-text-muted)" }}>
                {t(queueing ? "ea_queue_hint" : "ea_code_required")}
              </p>
            )}

            {/* The way between the two, and the only thing that decides which
                job the one field is doing. Absent where the API cannot take a
                name, so the gate is exactly what it was. */}
            <button
              type="button"
              onClick={() => {
                setQueueing((open) => !open);
                setCode("");
                setFailure(null);
              }}
              /* The landing's secondary: a ghost pill at the CTA's height,
                 lighting on hover. Same pair, same page, same two weights. */
              className="vg-ease mt-1 h-12 rounded-full px-5 text-[15px] hover:bg-white/5"
              /* The landing's ghost, with a ring: there it sits beside one
                 other button and reads as a control by context, and here it is
                 the alternative to the whole page — somebody with no code has
                 nothing else to press. */
              style={{ color: "var(--vg-text-secondary)", boxShadow: "inset 0 0 0 1px var(--vg-border)" }}
            >
              {t(queueing ? "ea_have_code" : "ea_no_code")}
            </button>
          </form>
        )}
      </div>

      {/* Not in the mockup, and both have to be here: somebody who already has
          an account needs a way in that they can actually see, and the legal
          row is what eNamad's reviewer has to reach from the front page.

          A bordered control rather than a line of faint text — the first
          version was grey on black under everything else, which is where a
          returning customer gives up and assumes the site is shut. */}
      <div className="relative z-10 mt-10 flex flex-col items-center gap-5">
        <div className="flex items-center gap-2.5 text-[12.5px]">
          <span style={{ color: "var(--vg-text-muted)" }}>{t("ea_has_account")}</span>
          <button
            type="button"
            className="vg-ease h-10 rounded-full px-5 text-[13.5px] hover:bg-white/5"
            style={{ color: "var(--vg-text-secondary)", boxShadow: "inset 0 0 0 1px var(--vg-border)" }}
            onClick={() => router.push(SIGN_IN_PATH)}
          >
            {t("ea_signin_cta")}
          </button>
        </div>
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
