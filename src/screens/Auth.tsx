"use client";

import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowLeft } from "@phosphor-icons/react";
import { DotField } from "../components/DotField";
import { BRAND } from "../data/brand";
import { useAuth } from "../features/session/useAuth";
import { useSession } from "../features/session/useSession";
import { faNum, latinDigits } from "../lib/format";
import { useI18n, type TKey } from "../lib/i18n";
import { EASE_OUT } from "../lib/motion";
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
   an account.

   COMPOSITION. There is no card. The form sits directly on the dot field with a
   radial well of black behind the type to keep it legible, because a bordered
   panel floating on an animated background is two competing frames and the
   background loses. Everything is a pill: the input, the code group, the button.
   Steps slide rather than swap, and the slide mirrors under RTL — a "next" that
   enters from the left is going backwards in Persian. */

export type AuthMode = "signin" | "signup";
type Method = "phone" | "email";

const CODE_LENGTH = 6;
const emptyCode = () => Array.from({ length: CODE_LENGTH }, () => "");

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

/**
 * A duration sitting inside a Persian sentence.
 *
 * Only the clock is isolated and forced LTR — not the sentence around it. Giving
 * the whole string `dir="ltr"` sets the base direction of Persian prose to
 * left-to-right, which happens to look right for this one phrase and puts the
 * full stop on the wrong end of the next one. `bdi` is the element for exactly
 * this: an inline run whose direction does not leak either way.
 */
function Countdown({ template, value }: { template: string; value: string }) {
  const [before, after] = template.split("{n}");
  return (
    <>
      {before}
      <bdi dir="ltr">{value}</bdi>
      {after}
    </>
  );
}

const PILL = "vg-ease w-full rounded-full border py-3.5 text-center text-[15px] outline-none";

/** The pill input, with its submit arrow tucked inside the trailing end. */
function PillField({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: (props: { id: string; describedBy: string | undefined }) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="grid gap-2">
      {/* Visible label, not a placeholder standing in for one. The reference
          relies on placeholders alone; a placeholder disappears the moment
          someone types, which is exactly when they need to know what the field
          was for. */}
      <label htmlFor={id} className="px-1 text-start text-[12.5px] font-semibold" style={{ color: "var(--vg-text-secondary)" }}>
        {label}
      </label>
      {children({ id, describedBy })}
      {hint && !error && (
        <p id={hintId} className="px-1 text-start text-[12px] leading-[1.7]" style={{ color: "var(--vg-text-faint)" }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="px-1 text-start text-[12.5px] leading-[1.7]" style={{ color: "var(--vg-danger)" }}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Six boxes rather than one field.
 *
 * Kept `dir="ltr"` as a group: a verification code is a number read left to
 * right in both languages, and mirroring the boxes would put the first digit
 * where the last one is expected. Each box carries its own accessible name
 * because a screen reader landing on box four with no name announces nothing
 * useful, and the e2e suite selects by role and name.
 */
function CodeBoxes({
  digits,
  onDigits,
  groupLabel,
  digitLabel,
  describedBy,
  disabled,
}: {
  digits: string[];
  onDigits: (next: string[]) => void;
  groupLabel: string;
  digitLabel: (index: number) => string;
  describedBy: string | undefined;
  disabled: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (index: number, raw: string) => {
    // Persian and Arabic keyboards produce ۰-۹ and ٠-٩; OtpCodeSchema is
    // /^\d{6}$/ and the body is .strict(), so they have to be latin by the time
    // this leaves the browser.
    const digit = latinDigits(raw).replace(/\D/g, "").slice(-1);
    const next = digits.map((value, i) => (i === index ? digit : value));
    onDigits(next);
    if (digit && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus();
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < CODE_LENGTH - 1) refs.current[index + 1]?.focus();
  };

  /** One paste fills the row — the way every OTP arrives, out of an SMS. */
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = latinDigits(event.clipboardData.getData("text")).replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!pasted) return;
    event.preventDefault();
    onDigits(Array.from({ length: CODE_LENGTH }, (_, i) => pasted[i] ?? ""));
    refs.current[Math.min(pasted.length, CODE_LENGTH - 1)]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={groupLabel}
      aria-describedby={describedBy}
      dir="ltr"
      className="flex w-full items-center justify-center gap-1 rounded-full border py-3"
      style={{ borderColor: "var(--vg-border)", background: "rgb(255 255 255 / 0.02)" }}
    >
      {digits.map((digit, index) => (
        <Fragment key={index}>
          <input
            ref={(element) => {
              refs.current[index] = element;
            }}
            aria-label={digitLabel(index)}
            value={digit}
            onChange={(event) => setDigit(index, event.target.value)}
            onKeyDown={(event) => onKeyDown(index, event)}
            onPaste={onPaste}
            onFocus={(event) => event.target.select()}
            inputMode="numeric"
            autoComplete={index === 0 ? "one-time-code" : "off"}
            maxLength={1}
            disabled={disabled}
            className="w-8 bg-transparent text-center text-[20px] outline-none"
            style={{ fontFamily: "var(--vg-font-mono)", color: "var(--vg-text)" }}
          />
          {index < CODE_LENGTH - 1 && (
            <span aria-hidden className="text-[18px]" style={{ color: "var(--vg-border-strong)" }}>
              |
            </span>
          )}
        </Fragment>
      ))}
    </div>
  );
}

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
  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [inviteNeeded, setInviteNeeded] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);
  const [leaving, setLeaving] = useState(false);

  const secondsLeft = useResendCooldown(sentAt);
  const codeSent = sentAt !== null;

  // Covers both halves of the same question: someone who is already signed in
  // should never see this screen, and someone who just signed in should not have
  // to be sent onward by each individual handler. The gate at "/" decides what
  // they get once they land.
  useEffect(() => {
    if (session.data?.status !== "authed") return;
    // The dot field collapses back into the dark before the route changes, so
    // the sign-in reads as a door opening rather than a page swap. The redirect
    // does not wait on it — it is a paint, not a gate.
    setLeaving(true);
    const id = setTimeout(() => router.replace("/"), 900);
    return () => clearTimeout(id);
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
      setDigits(emptyCode());
    });
  };

  const submitCode = () =>
    void run(() =>
      verifyPhone.mutateAsync({
        phone: phone.trim(),
        code: digits.join(""),
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
  // through to the field that owns the step.
  const onInvite = inviteNeeded && (failure === "auth_err_invite_required" || failure === "auth_err_invite_invalid");
  const onCode = codeSent && !onInvite;
  const onEmailForm = method === "email" && !onInvite;
  const codeComplete = digits.every((digit) => digit !== "");

  /* In RTL, forward is leftward. Sliding a "next" step in from the left is
     walking backwards, so the sign flips with the language. */
  const forward = lang === "fa" ? -1 : 1;
  const step = { initial: { opacity: 0, x: 60 * forward }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -60 * forward } };
  const transition = { duration: 0.4, ease: EASE_OUT };

  const pillStyle = { borderColor: "var(--vg-border)", background: "rgb(255 255 255 / 0.02)", color: "var(--vg-text)" };
  const submitPill = "vg-ease w-full rounded-full py-3.5 text-[15px] font-bold enabled:active:scale-[0.99]";
  /* A disabled primary is not a faded primary. index.css already states the rule
     for `.btn-accent:disabled` — it must not read as tappable — and a dimmed
     accent still does, especially against a dark field where opacity mostly eats
     the glow. So the disabled state drops out of the accent entirely. */
  const submitStyle = (isDisabled: boolean) =>
    isDisabled
      ? { background: "var(--vg-surface-raised)", color: "var(--vg-text-faint)", boxShadow: "none", cursor: "default" }
      : {
          background: "var(--vg-primary)",
          color: "var(--vg-text-on-primary)",
          boxShadow: "0 0 44px rgb(var(--vg-primary-rgb) / 0.3), inset 0 1px 0 rgb(255 255 255 / 0.25)",
        };

  const inviteField = inviteNeeded && (
    <PillField label={t("auth_invite_label")} hint={t("auth_invite_hint")} error={onInvite ? failureText : undefined}>
      {({ id, describedBy }) => (
        <input
          id={id}
          aria-describedby={describedBy}
          className={`${PILL} focus:border-accent`}
          style={pillStyle}
          value={invite}
          onChange={(event) => setInvite(event.target.value)}
          autoComplete="off"
          dir="ltr"
          required
        />
      )}
    </PillField>
  );

  return (
    <main className="relative flex min-h-[100dvh] flex-col overflow-hidden" style={{ background: "var(--vg-canvas)" }}>
      {/* The scene. The field wakes on arrival and collapses on the way out. */}
      <div className="absolute inset-0 z-0">
        <DotField key={leaving ? "out" : "in"} reverse={leaving} className="absolute inset-0 h-full w-full" />
        {/* A well of black under the type. Without it the dots run straight
            through the headline and nothing is readable at the centre. */}
        <div
          className="absolute inset-0"
          style={{ background: "radial-gradient(circle at 50% 46%, var(--vg-canvas) 0%, rgb(9 9 9 / 0.86) 32%, transparent 72%)" }}
          aria-hidden
        />
        <div
          className="absolute inset-x-0 top-0 h-1/3"
          style={{ background: "linear-gradient(to bottom, var(--vg-canvas), transparent)" }}
          aria-hidden
        />
        <div
          className="absolute inset-x-0 bottom-0 h-1/3"
          style={{ background: "linear-gradient(to top, var(--vg-canvas), transparent)" }}
          aria-hidden
        />
      </div>

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-5 py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex flex-col items-center text-center">
            <span
              className="text-[18px] font-light tracking-[0.34em]"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
              lang="en"
            >
              {BRAND.name}
            </span>
            <span
              className="mt-1.5 text-[9px] font-semibold uppercase tracking-[0.2em]"
              style={{ color: "var(--vg-text-faint)", fontFamily: "var(--vg-font-latin)" }}
              lang="en"
            >
              {BRAND.tagline}
            </span>
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={codeSent ? "code" : "credentials"} {...step} transition={transition} className="grid gap-7">
              <div className="text-center">
                <h1
                  className="text-[clamp(2rem,7vw,2.6rem)] font-extrabold leading-[1.18]"
                  style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
                >
                  {codeSent ? t("auth_code_label") : t(mode === "signin" ? "auth_signin_title" : "auth_signup_title")}
                </h1>
                <p className="mt-2 text-[15px] font-light leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
                  {codeSent ? t("auth_code_sent") : t(mode === "signin" ? "auth_signin_sub" : "auth_signup_sub")}
                </p>
              </div>

              {codeSent ? (
                <form
                  className="grid gap-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitCode();
                  }}
                >
                  <CodeBoxes
                    digits={digits}
                    onDigits={setDigits}
                    groupLabel={t("auth_code_label")}
                    digitLabel={(index) => t("auth_code_digit").replace("{n}", lang === "fa" ? faNum(index + 1) : String(index + 1))}
                    describedBy={undefined}
                    disabled={pending}
                  />
                  {onCode && failureText && (
                    <p role="alert" className="text-center text-[12.5px]" style={{ color: "var(--vg-danger)" }}>
                      {failureText}
                    </p>
                  )}

                  {inviteField}

                  <button
                    type="submit"
                    disabled={pending || !codeComplete}
                    className={submitPill}
                    style={submitStyle(pending || !codeComplete)}
                  >
                    {verifyPhone.isPending ? t("auth_verifying") : t("auth_verify")}
                  </button>

                  <div className="flex items-center justify-between gap-3 px-1 text-[12.5px]">
                    <button
                      type="button"
                      className="vg-ease hover:text-[color:var(--vg-text)]"
                      style={{ color: "var(--vg-text-faint)" }}
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
                      className="vg-ease"
                      style={{ color: secondsLeft > 0 ? "var(--vg-text-faint)" : "var(--vg-accent)" }}
                      onClick={() =>
                        void run(async () => {
                          await startPhoneVerification.mutateAsync({ phone: phone.trim() });
                          setSentAt(Date.now());
                        })
                      }
                    >
                      {secondsLeft > 0 ? (
                        <Countdown template={t("auth_resend_in")} value={lang === "fa" ? faNum(clock(secondsLeft)) : clock(secondsLeft)} />
                      ) : (
                        t("auth_resend")
                      )}
                    </button>
                  </div>
                </form>
              ) : method === "phone" ? (
                <form className="grid gap-5" onSubmit={(event) => void sendCode(event)}>
                  <PillField label={t("auth_phone_label")} hint={t("auth_phone_hint")} error={failureText}>
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className={`${PILL} focus:border-accent`}
                        style={pillStyle}
                        value={phone}
                        onChange={(event) => setPhone(event.target.value)}
                        inputMode="tel"
                        autoComplete="tel"
                        placeholder="0912 345 6789"
                        dir="ltr"
                        required
                      />
                    )}
                  </PillField>

                  <button type="submit" disabled={pending} className={submitPill} style={submitStyle(pending)}>
                    {startPhoneVerification.isPending ? t("auth_sending") : t("auth_send_code")}
                  </button>
                </form>
              ) : (
                <form className="grid gap-5" onSubmit={submitEmail}>
                  <PillField label={t("auth_email_label")}>
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className={`${PILL} focus:border-accent`}
                        style={pillStyle}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        type="email"
                        autoComplete="email"
                        dir="ltr"
                        required
                      />
                    )}
                  </PillField>

                  <PillField
                    label={t("auth_password_label")}
                    hint={mode === "signup" ? t("auth_password_hint") : undefined}
                    error={onEmailForm ? failureText : undefined}
                  >
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        className={`${PILL} focus:border-accent`}
                        style={pillStyle}
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
                  </PillField>

                  {inviteField}

                  <button type="submit" disabled={pending} className={submitPill} style={submitStyle(pending)}>
                    {pending ? t("auth_working") : t(mode === "signin" ? "auth_signin_submit" : "auth_signup_submit")}
                  </button>
                </form>
              )}
            </motion.div>
          </AnimatePresence>

          {!codeSent && (
            <div className="mt-8 flex flex-col items-center gap-4 text-[12.5px]">
              {/* A quiet line rather than a segmented control: two credentials,
                  one of which most people here will never use, and a box round
                  them would give the choice more weight than the form. */}
              <button
                type="button"
                className="vg-ease hover:text-[color:var(--vg-text)]"
                style={{ color: "var(--vg-text-secondary)" }}
                onClick={() => {
                  setMethod(method === "phone" ? "email" : "phone");
                  setFailure(null);
                }}
              >
                {t(method === "phone" ? "auth_use_email" : "auth_use_phone")}
              </button>

              <button
                type="button"
                className="vg-ease hover:text-[color:var(--vg-text)]"
                style={{ color: "var(--vg-accent)" }}
                onClick={() => router.push(mode === "signin" ? SIGN_UP_PATH : SIGN_IN_PATH)}
              >
                {t(mode === "signin" ? "auth_to_signup" : "auth_to_signin")}
              </button>

              <a
                href="/"
                className="vg-ease inline-flex items-center gap-1.5 hover:text-[color:var(--vg-text-secondary)]"
                style={{ color: "var(--vg-text-faint)" }}
              >
                {/* Back points the way back, which under RTL is rightward — the
                    opposite of the landing hero's arrow, whose button means
                    "start" and so points the way forward. */}
                <ArrowLeft size={13} weight="bold" className="rtl:-scale-x-100" />
                {t("auth_back_home")}
              </a>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
