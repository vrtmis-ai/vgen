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
import { VendorMark } from "../components/VendorMark";
import { BRAND } from "../data/brand";
import { useAuth } from "../features/session/useAuth";
import { useSession } from "../features/session/useSession";
import { faNum, latinDigits } from "../lib/format";
import { useI18n, type TKey } from "../lib/i18n";
import { EASE_OUT } from "../lib/motion";
import { ApiError } from "../runtime/apiError";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "../runtime/providers/authActions";
import type { OAuthProvider } from "../runtime/contracts/auth";

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

/** What a failure looks like once the screen is done with it. */
interface Failure {
  key: TKey;
  /** Substituted into `{n}` — only ever a duration, and only when we know one. */
  amount?: string | undefined;
}

/**
 * Which message a failure gets. Branch on `code`, never on `message`.
 *
 * `step` is here because one code is genuinely ambiguous. A malformed phone
 * number comes back as `validation_failed`, which on the email form means the
 * email or the password and on the phone form can only mean the number — so the
 * generic "something in the form is wrong" is right in one place and needlessly
 * vague in the other. Demo mode throws `invalid_phone` for the same input, which
 * the API has no such code for; both now land on the same message, so the screen
 * does not change what it says between the mode it was built in and production.
 */
function messageFor(error: unknown, step: "phone" | "code" | "email"): Failure {
  if (!(error instanceof ApiError)) return { key: "auth_err_generic" };
  switch (error.code) {
    case "invite_required":
      return { key: "auth_err_invite_required" };
    case "invite_invalid":
      return { key: "auth_err_invite_invalid" };
    case "otp_invalid":
      return { key: "auth_err_otp_invalid" };
    case "otp_expired":
      return { key: "auth_err_otp_expired" };
    case "otp_exhausted":
      return { key: "auth_err_otp_exhausted" };
    case "invalid_credentials":
      return { key: "auth_err_invalid_credentials" };
    case "account_taken":
      return { key: "auth_err_account_taken" };
    case "account_suspended":
      // Terminal, and the only failure on this screen that retrying cannot fix.
      // It used to fall through to "something went wrong, please try again",
      // which sends someone to hammer a door that has been locked deliberately.
      return { key: "auth_err_account_suspended" };
    case "rate_limited":
      // The server says how long in `Retry-After`, and docs/API.md asks callers
      // to surface the wait rather than silently retry. "Wait a moment" when the
      // exact number is sitting in the error is a worse answer than the one we
      // already have.
      return error.retryAfterMs === undefined
        ? { key: "auth_err_rate_limited" }
        : { key: "auth_err_rate_limited_in", amount: clock(Math.ceil(error.retryAfterMs / 1000)) };
    case "invalid_phone":
      return { key: "auth_err_invalid_phone" };
    case "validation_failed":
    case "invalid_request":
      return { key: step === "phone" ? "auth_err_invalid_phone" : "auth_err_validation" };
    default:
      return { key: "auth_err_generic" };
  }
}

/** Nothing the user can do on this step will change the answer. */
const TERMINAL_FOR_CODE: readonly TKey[] = ["auth_err_otp_exhausted", "auth_err_otp_expired", "auth_err_account_suspended"];

/**
 * Every provider this screen knows how to draw. Which of them a visitor is
 * actually shown comes from `session.authProviders` — a provider whose
 * credentials are unset has no route at all server-side, and drawing its
 * button sent people into a 404 after they had already chosen it.
 *
 * The mark is `VendorMark`'s monogram rather than either company's logo, for the
 * same reason the model row uses one: a trademark is not ours to ship until
 * somebody has read that brand's terms.
 */
const PROVIDERS: { id: OAuthProvider; vendor: string; label: TKey }[] = [
  { id: "google", vendor: "Google", label: "auth_with_google" },
  { id: "microsoft", vendor: "Microsoft", label: "auth_with_microsoft" },
];

const isInviteFailure = (error: unknown) =>
  error instanceof ApiError && (error.code === "invite_required" || error.code === "invite_invalid");

/**
 * One minute — and it is deliberately the same minute twice.
 *
 * A code lives for sixty seconds, and sixty seconds is also how long the resend
 * button stays disabled. That is one clock with two readings rather than two
 * clocks: the instant the code dies is the instant a new one can be asked for,
 * so there is never a gap where the screen is holding a dead code and refusing
 * to replace it, and never a window where two codes are live at once.
 *
 * It also spends the SMS budget sanely — `otp.send` in 0005_security.sql allows
 * five texts per phone per hour, which a one-minute floor cannot exhaust by
 * accident.
 *
 * **The server does not agree yet.** It issues codes valid for five minutes, so
 * until that is shortened this screen is the stricter of the two: it will call a
 * code expired while the API would still take it. Being stricter is the safe
 * direction — nobody is told a live code is dead *and* left with no way forward,
 * because expiry and resend unlock together — but it is a real divergence and
 * the backend owner has to close it.
 */
const CODE_LIFETIME_MS = 60_000;

/** m:ss. A raw "297 seconds" is a number nobody converts in their head. */
function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function remainingSeconds(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

/**
 * Whole seconds until a moment, re-read from the wall clock every render.
 *
 * The value is *derived*, not stored — the interval exists only to force the
 * re-render, and the number itself always comes from `Date.now()`. Holding it in
 * state instead is what produces the classic one-frame lie: state seeded at zero
 * renders "expired" for the single frame between the code being sent and the
 * first tick, and a backgrounded tab that misses ticks resumes counting from
 * wherever it left off rather than from the truth.
 */
function useSecondsUntil(deadline: number | null): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => {
      tick((n) => n + 1);
      if (deadline <= Date.now()) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [deadline]);
  return remainingSeconds(deadline);
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
  const { startPhoneVerification, verifyPhone, login, register, startProviderSignIn } = useAuth();

  // Only the providers this server actually registered. While the session is
  // still loading the list is empty, so the block appears once rather than
  // flashing two buttons and then removing one.
  const offered = session.data?.status === "loading" ? [] : (session.data?.authProviders ?? []);
  const providers = PROVIDERS.filter((provider) => offered.includes(provider.id));

  const [method, setMethod] = useState<Method>("phone");

  const [phone, setPhone] = useState("");
  const [digits, setDigits] = useState<string[]>(emptyCode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");

  const [sentAt, setSentAt] = useState<number | null>(null);
  const [serverExpiresAt, setServerExpiresAt] = useState<number | null>(null);
  const [inviteNeeded, setInviteNeeded] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [leaving, setLeaving] = useState(false);

  /** Digits in the reader's own script. A clock is the only number this screen prints. */
  const localDigits = (value: string) => (lang === "fa" ? faNum(value) : value);

  const codeSent = sentAt !== null;
  /* The shorter of our minute and whatever the server actually granted.
     Ours is the shorter of the two today, and taking the minimum is what keeps
     that from being an assumption: if the API ever hands back a code with less
     than a minute left on it, the screen follows the API rather than promising
     time the server will not honour. */
  const deadline = sentAt === null ? null : Math.min(sentAt + CODE_LIFETIME_MS, serverExpiresAt ?? Number.POSITIVE_INFINITY);
  const secondsLeft = useSecondsUntil(deadline);
  /* One clock, two readings: at zero the code is dead *and* resend is unlocked,
     which is why there is no state here where the screen is holding an expired
     code and refusing to replace it. */
  const codeExpired = codeSent && secondsLeft === 0;

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
  async function run(step: "phone" | "code" | "email", action: () => Promise<unknown>) {
    setFailure(null);
    try {
      await action();
    } catch (error) {
      setFailure(messageFor(error, step));
      if (isInviteFailure(error)) setInviteNeeded(true);
    }
  }

  /** Sending and resending are the same act, so they restart the same clock. */
  const requestCode = () =>
    run("phone", async () => {
      // Sent as typed. The server normalises, and it has to be the only thing that does.
      const started = await startPhoneVerification.mutateAsync({ phone: phone.trim() });
      setSentAt(Date.now());
      setServerExpiresAt(started.expiresAt);
      setDigits(emptyCode());
    });

  const submitCode = () =>
    void run("code", () =>
      verifyPhone.mutateAsync({
        phone: phone.trim(),
        code: digits.join(""),
        inviteCode: invite.trim() || undefined,
      }),
    );

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    void run("email", () =>
      mode === "signin"
        ? login.mutateAsync({ email: email.trim(), password })
        : register.mutateAsync({ email: email.trim(), password, inviteCode: invite.trim() || undefined }),
    );
  };

  // `{n}` is only ever a duration here, and it is isolated with `bdi` wherever it
  // is rendered, so a Persian sentence keeps its own direction around it.
  const failureText = failure ? t(failure.key).replace("{n}", failure.amount ?? "") : undefined;
  // One message per screen, on the field it belongs to. Everything else falls
  // through to the field that owns the step.
  const onInvite = inviteNeeded && (failure?.key === "auth_err_invite_required" || failure?.key === "auth_err_invite_invalid");
  const onCode = codeSent && !onInvite;
  const onPhoneForm = !codeSent && method === "phone";
  const onEmailForm = method === "email" && !onInvite;
  const codeComplete = digits.every((digit) => digit !== "");
  /* A failure that resending cannot fix — out of attempts, or suspended. Kept
     apart from expiry because the two disagree about what to tell someone, and
     this one is right: "get a new code" is bad advice when the next code will be
     refused too. */
  const terminalFailure = failure != null && TERMINAL_FOR_CODE.includes(failure.key);
  /* Expired, out of attempts, or suspended: three different sentences for the
     same situation, which is that this code will never be accepted. The boxes
     and the submit go dead together so the screen stops inviting a keystroke it
     is going to reject — and resend is unlocked in every one of these states, so
     the way out is the one control still lit. */
  const codeRefused = codeExpired || terminalFailure;

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
                    disabled={pending || codeRefused}
                  />

                  {/* One line, three things to say, in the one place someone is
                      looking while they wait for a text.

                      Newest true thing wins, and the order matters. A failure
                      resending cannot fix comes first, because "get a new code"
                      is bad advice when the next one will be refused too. Expiry
                      comes next — it outranks an ordinary failure because it
                      happened *after* it: a stale "that code is not right" while
                      the boxes sit disabled tells someone to correct something
                      they can no longer type into. Then the failure itself, and
                      failing all of that, the clock: a hint while there is time,
                      amber inside the last ten seconds, because "0:47" and "0:06"
                      are not the same news.

                      Running out is not an error the server reported, it is
                      something this screen observed, so nothing sets `failure` and
                      the message has to come from the clock.

                      `role="alert"` on everything except the live countdown,
                      which would interrupt a screen reader once a second all the
                      way down. */}
                  {onCode &&
                    (terminalFailure ? (
                      <p role="alert" className="text-center text-[12.5px] leading-[1.7]" style={{ color: "var(--vg-danger)" }}>
                        {failureText}
                      </p>
                    ) : codeExpired ? (
                      <p role="alert" className="text-center text-[12.5px] leading-[1.7]" style={{ color: "var(--vg-danger)" }}>
                        {t("auth_code_expired")}
                      </p>
                    ) : failureText ? (
                      <p role="alert" className="text-center text-[12.5px] leading-[1.7]" style={{ color: "var(--vg-danger)" }}>
                        {failure?.amount ? <Countdown template={t(failure.key)} value={localDigits(failure.amount)} /> : failureText}
                      </p>
                    ) : (
                      <p
                        className="text-center text-[12.5px] leading-[1.7]"
                        style={{ color: secondsLeft <= 10 ? "var(--vg-warning)" : "var(--vg-text-faint)" }}
                      >
                        <Countdown template={t("auth_code_expires_in")} value={localDigits(clock(secondsLeft))} />
                      </p>
                    ))}

                  {inviteField}

                  <button
                    type="submit"
                    disabled={pending || !codeComplete || codeRefused}
                    className={submitPill}
                    style={submitStyle(pending || !codeComplete || codeRefused)}
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
                        setServerExpiresAt(null);
                        setFailure(null);
                      }}
                    >
                      {t("auth_change_phone")}
                    </button>
                    <button
                      type="button"
                      disabled={secondsLeft > 0 || pending}
                      className="vg-ease"
                      /* Once the code is dead this is the only way forward, so it
                         stops being a quiet accent link and takes the weight the
                         submit button just gave up. */
                      style={{
                        color: secondsLeft > 0 ? "var(--vg-text-faint)" : "var(--vg-accent)",
                        fontWeight: codeRefused ? 700 : 400,
                      }}
                      onClick={() => void requestCode()}
                    >
                      {secondsLeft > 0 ? (
                        <Countdown template={t("auth_resend_in")} value={localDigits(clock(secondsLeft))} />
                      ) : (
                        t("auth_resend")
                      )}
                    </button>
                  </div>
                </form>
              ) : method === "phone" ? (
                <form
                  className="grid gap-5"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void requestCode();
                  }}
                >
                  {/* Gated like the other two steps. It was showing whatever the
                      last failure was regardless of which form produced it. */}
                  <PillField label={t("auth_phone_label")} hint={t("auth_phone_hint")} error={onPhoneForm ? failureText : undefined}>
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

          {!codeSent && providers.length > 0 && (
            <>
              {/* An additional door, not the main one — and the layout has to say
                  so. Neither provider is dependably reachable from Iran without a
                  VPN, so giving these the accent fill would point most visitors
                  at the one route that will hang for them. Outline, below the
                  form, under a rule that reads as "or, if you can". */}
              <div className="mt-8 flex items-center gap-3" aria-hidden>
                <hr className="min-w-0 flex-1" style={{ borderColor: "var(--vg-border-subtle)" }} />
                <span className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                  {t("auth_or")}
                </span>
                <hr className="min-w-0 flex-1" style={{ borderColor: "var(--vg-border-subtle)" }} />
              </div>

              <div className="mt-5 grid gap-2.5">
                {providers.map(({ id, vendor, label }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={startProviderSignIn.isPending}
                    onClick={() => void run("email", () => startProviderSignIn.mutateAsync(id))}
                    className="vg-ease flex w-full items-center justify-center gap-2.5 rounded-full border py-3 text-[13.5px] font-semibold disabled:opacity-60"
                    style={{ borderColor: "var(--vg-border)", background: "rgb(255 255 255 / 0.02)", color: "var(--vg-text-secondary)" }}
                  >
                    <VendorMark vendor={vendor} size={18} />
                    {t(label)}
                  </button>
                ))}
                <p className="px-1 text-center text-[11.5px] leading-[1.7]" style={{ color: "var(--vg-text-faint)" }}>
                  {t("auth_provider_note")}
                </p>
              </div>
            </>
          )}

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
