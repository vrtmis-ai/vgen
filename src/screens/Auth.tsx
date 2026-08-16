"use client";

import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, DeviceMobile, EnvelopeSimple } from "@phosphor-icons/react";
import { BRAND } from "../data/brand";
import { useAuth } from "../features/session/useAuth";
import { useSession } from "../features/session/useSession";
import { faNum, latinDigits } from "../lib/format";
import { useI18n, type TKey } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "../runtime/providers/authActions";

/* The screen `authActions.signIn` had nowhere to send anyone.
   `AppServices.auth` and both adapters landed in #5; this is the surface on top
   of them, and it is the last thing between an anonymous visitor and the product.

   It lives in app/(auth)/ rather than under app/(app)/ on purpose. The session
   gate returns early for an anonymous session — that is what keeps the landing
   page out of the phone-shaped app shell — so a route nested under it could
   never render for the one person who needs it. The root layout is above both,
   so Providers, i18n and AppServices are all still in scope here.

   Nothing on this screen collects an invite code up front. Early access is a
   server-side switch an admin can turn off, so the honest way to ask is to let
   the server say `invite_required` and reveal the field then — which is also the
   only way the phone route can stay one field long for someone who already has
   an account. */

export type AuthMode = "signin" | "signup";
type Method = "phone" | "email";

/** Which message a failure gets. Branch on `code`, never on `message`. */
function messageFor(error: unknown): TKey {
  if (!(error instanceof ApiError)) return "auth_err_generic";
  switch (error.code) {
    case "invite_required":
      return "auth_err_invite_required";
    case "invite_invalid":
      return "auth_err_invite_invalid";
    case "otp_invalid":
      return "auth_err_otp_invalid";
    case "otp_expired":
      return "auth_err_otp_expired";
    case "otp_exhausted":
      return "auth_err_otp_exhausted";
    case "invalid_credentials":
      return "auth_err_invalid_credentials";
    case "account_taken":
      return "auth_err_account_taken";
    case "rate_limited":
      return "auth_err_rate_limited";
    case "invalid_phone":
      return "auth_err_invalid_phone";
    case "validation_failed":
    case "invalid_request":
      return "auth_err_validation";
    default:
      return "auth_err_generic";
  }
}

const isInviteFailure = (error: unknown) =>
  error instanceof ApiError && (error.code === "invite_required" || error.code === "invite_invalid");

/**
 * How long the resend button stays disabled.
 *
 * Deliberately NOT the server's `expiresAt`, which docs/API.md suggests counting
 * to. That value is how long the *code* stays valid — five minutes — and using
 * it here locks someone who mistyped their number out of trying again for five
 * minutes. The server has no resend cooldown at all; what it has is a budget,
 * `otp.send` in 0005_security.sql: five texts per phone per hour. A minute is
 * the interval a user expects, and it spends that budget at a sane rate.
 */
const RESEND_COOLDOWN_SECONDS = 60;

/** m:ss. A raw "297 seconds" is a number nobody converts in their head. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Seconds left on the resend cooldown, ticking once a second. */
function useResendCooldown(sentAt: number | null): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (sentAt === null) return;
    const tick = () => setLeft(Math.max(0, RESEND_COOLDOWN_SECONDS - Math.floor((Date.now() - sentAt) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sentAt]);
  return left;
}

/** Label, control and message as one unit, so no input can end up unnamed. */
function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string | undefined;
  error?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="t-title text-ink">
        {label}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="t-caption text-ink3">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="t-caption text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT =
  "min-h-11 w-full rounded-md border border-line2 bg-bg px-3.5 text-[15px] text-ink placeholder:text-ink3 transition-colors focus:border-accent";

/* `mode` is the route, not state. /signin and /signup are separate URLs, so
   switching between them is a navigation — which remounts this component and
   clears the form. That is the honest behaviour for two addresses, it makes the
   back button work, and it is what every other sign-in page on the web does. */
export default function Auth({ mode }: { mode: AuthMode }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const session = useSession();
  const { startPhoneVerification, verifyPhone, login, register } = useAuth();

  const [method, setMethod] = useState<Method>("phone");

  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [inviteNeeded, setInviteNeeded] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);

  const secondsLeft = useResendCooldown(sentAt);
  const codeSent = sentAt !== null;

  // Covers both halves of the same question: someone who is already signed in
  // should never see this screen, and someone who just signed in should not have
  // to be sent onward by each individual handler. The gate at "/" decides what
  // they get once they land.
  useEffect(() => {
    if (session.data?.status === "authed") router.replace("/");
  }, [session.data?.status, router]);

  const pending = startPhoneVerification.isPending || verifyPhone.isPending || login.isPending || register.isPending;

  /** Every submit fails the same way, so the reset and the catch live in one place. */
  async function run(action: () => Promise<unknown>) {
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(messageFor(error));
      if (isInviteFailure(error)) setInviteNeeded(true);
    }
  }

  const sendCode = (event: FormEvent) => {
    event.preventDefault();
    // Sent as typed. The server normalises, and it has to be the only thing that does.
    return run(async () => {
      await startPhoneVerification.mutateAsync({ phone: phone.trim() });
      setSentAt(Date.now());
      setCode("");
    });
  };

  const submitCode = () =>
    void run(() =>
      verifyPhone.mutateAsync({
        phone: phone.trim(),
        code: latinDigits(code).trim(),
        inviteCode: invite.trim() || undefined,
      }),
    );

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    void run(() =>
      mode === "signin"
        ? login.mutateAsync({ email: email.trim(), password })
        : register.mutateAsync({ email: email.trim(), password, inviteCode: invite.trim() || undefined }),
    );
  };

  const failureText = failure ? t(failure) : undefined;
  // One message per screen, on the field it belongs to. Everything else falls
  // through to the form-level slot below the button.
  const onInvite = inviteNeeded && (failure === "auth_err_invite_required" || failure === "auth_err_invite_invalid");
  const onCode = codeSent && !onInvite;
  const onEmailForm = method === "email" && !onInvite;

  const inviteField = inviteNeeded && (
    <Field label={t("auth_invite_label")} hint={t("auth_invite_hint")} error={onInvite ? failureText : undefined}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          className={INPUT}
          value={invite}
          onChange={(event) => setInvite(event.target.value)}
          autoComplete="off"
          dir="ltr"
          required
        />
      )}
    </Field>
  );

  return (
    <main className="relative isolate grid min-h-[100dvh] place-items-center overflow-hidden bg-bg px-5 py-10 text-ink">
      <div
        className="pointer-events-none absolute -start-32 top-1/3 -z-10 h-80 w-80 rounded-full blur-[110px]"
        style={{ background: "var(--vg-primary-a10)" }}
        aria-hidden
      />

      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <span className="text-[20px] font-bold tracking-tight" style={{ fontFamily: "var(--vg-font-display)" }} lang="en">
            {BRAND.name}
          </span>
          <h1 className="t-h1 mt-5 text-ink">{t(mode === "signin" ? "auth_signin_title" : "auth_signup_title")}</h1>
          <p className="t-caption mt-2 text-ink3">{t(mode === "signin" ? "auth_signin_sub" : "auth_signup_sub")}</p>
        </div>

        <div className="rounded-card border border-line bg-card p-5 sm:p-6">
          {/* Not a tablist: each of these swaps the whole form, and the two are
              separate credentials rather than two views of one thing. */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-card2 p-1">
            {(["phone", "email"] as const).map((option) => {
              const active = method === option;
              return (
                <button
                  key={option}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setMethod(option);
                    setFailure(null);
                  }}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xs text-[13px] font-semibold transition-colors ${
                    active ? "bg-raised text-ink" : "text-ink3 hover:text-ink2"
                  }`}
                >
                  {option === "phone" ? <DeviceMobile size={17} weight="bold" /> : <EnvelopeSimple size={17} weight="bold" />}
                  {t(option === "phone" ? "auth_method_phone" : "auth_method_email")}
                </button>
              );
            })}
          </div>

          {method === "phone" ? (
            codeSent ? (
              <form
                className="grid gap-5"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitCode();
                }}
              >
                <Field label={t("auth_code_label")} hint={t("auth_code_sent")} error={onCode ? failureText : undefined}>
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className={`${INPUT} text-center text-[19px] tracking-[0.4em]`}
                      value={code}
                      onChange={(event) => setCode(event.target.value)}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      dir="ltr"
                      required
                      autoFocus
                    />
                  )}
                </Field>

                {inviteField}

                <button
                  type="submit"
                  disabled={pending}
                  className="btn-accent min-h-[54px] rounded-card text-[15px] font-bold disabled:opacity-60"
                >
                  {verifyPhone.isPending ? t("auth_verifying") : t("auth_verify")}
                </button>

                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    className="t-caption text-ink3 transition-colors hover:text-ink2"
                    onClick={() => {
                      setSentAt(null);
                      setFailure(null);
                    }}
                  >
                    {t("auth_change_phone")}
                  </button>
                  <button
                    type="button"
                    disabled={secondsLeft > 0 || pending}
                    className="t-caption text-info transition-colors disabled:text-ink3"
                    onClick={() =>
                      void run(async () => {
                        await startPhoneVerification.mutateAsync({ phone: phone.trim() });
                        setSentAt(Date.now());
                      })
                    }
                  >
                    {/* The clock is a duration, not prose — it stays LTR so
                        "4:59" cannot be reordered into "59:4" by the RTL run. */}
                    {secondsLeft > 0 ? (
                      <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
                        {t("auth_resend_in").replace("{n}", lang === "fa" ? faNum(clock(secondsLeft)) : clock(secondsLeft))}
                      </span>
                    ) : (
                      t("auth_resend")
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <form className="grid gap-5" onSubmit={(event) => void sendCode(event)}>
                <Field label={t("auth_phone_label")} hint={t("auth_phone_hint")} error={failureText}>
                  {({ id, describedBy }) => (
                    <input
                      id={id}
                      aria-describedby={describedBy}
                      className={INPUT}
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                      dir="ltr"
                      required
                    />
                  )}
                </Field>

                <button
                  type="submit"
                  disabled={pending}
                  className="btn-accent min-h-[54px] rounded-card text-[15px] font-bold disabled:opacity-60"
                >
                  {startPhoneVerification.isPending ? t("auth_sending") : t("auth_send_code")}
                </button>
              </form>
            )
          ) : (
            <form className="grid gap-5" onSubmit={submitEmail}>
              <Field label={t("auth_email_label")}>
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    className={INPUT}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    dir="ltr"
                    required
                  />
                )}
              </Field>

              <Field
                label={t("auth_password_label")}
                hint={mode === "signup" ? t("auth_password_hint") : undefined}
                error={onEmailForm ? failureText : undefined}
              >
                {({ id, describedBy }) => (
                  <input
                    id={id}
                    aria-describedby={describedBy}
                    className={INPUT}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    // Only the sign-up form states the floor. `login` accepts
                    // min(1) on purpose, so that the password rules are not
                    // leaked to someone guessing at an existing account.
                    minLength={mode === "signup" ? 10 : undefined}
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    dir="ltr"
                    required
                  />
                )}
              </Field>

              {inviteField}

              <button
                type="submit"
                disabled={pending}
                className="btn-accent min-h-[54px] rounded-card text-[15px] font-bold disabled:opacity-60"
              >
                {pending ? t("auth_working") : t(mode === "signin" ? "auth_signin_submit" : "auth_signup_submit")}
              </button>
            </form>
          )}
        </div>

        <div className="mt-6 flex flex-col items-center gap-4">
          <button
            type="button"
            className="t-caption text-info transition-colors hover:text-ink"
            onClick={() => router.push(mode === "signin" ? SIGN_UP_PATH : SIGN_IN_PATH)}
          >
            {t(mode === "signin" ? "auth_to_signup" : "auth_to_signin")}
          </button>

          <a href="/" className="t-caption inline-flex items-center gap-1.5 text-ink3 transition-colors hover:text-ink2">
            <ArrowLeft size={14} weight="bold" className="rtl:rotate-180" />
            {t("auth_back_home")}
          </a>
        </div>
      </div>
    </main>
  );
}
