"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PasswordInput } from "../components/PasswordInput";
import { useI18n, type TKey } from "../lib/i18n";
import { ApiError } from "../runtime/apiError";
import { useAppServices } from "../runtime/AppServices";
import { SIGN_IN_PATH } from "../runtime/providers/authActions";
import { AuthScene, PILL, PillField, pillStyle, submitClass, submitStyle } from "./Auth";

/**
 * The way back in.
 *
 * Two halves of one flow, and one screen because they share every piece of
 * furniture: `/forgot` asks for a link, `/reset?token=…` spends one.
 *
 * **Nobody is signed in at the end of this.** The reset finishes by sending
 * somebody to the sign-in screen to type the password they just chose. A
 * reset that handed back a session would turn a mail link into a way into the
 * account — anyone who can read the mailbox would be inside without ever
 * knowing the password.
 */
export default function ResetPassword({ mode }: { mode: "forgot" | "reset" }) {
  return mode === "forgot" ? <AskForLink /> : <SetNewPassword />;
}

/** One heading, one paragraph — the same shape `Auth.tsx` opens with. */
function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="text-center">
      <h1
        className="text-[clamp(2rem,7vw,2.6rem)] font-extrabold leading-[1.18]"
        style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
      >
        {title}
      </h1>
      <p className="mt-2 text-[15px] font-light leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
        {subtitle}
      </p>
    </div>
  );
}

function BackToSignIn({ label }: { label: string }) {
  return (
    <a
      href={SIGN_IN_PATH}
      className="vg-ease text-center text-[13px] underline-offset-4 hover:underline"
      style={{ color: "var(--vg-accent)" }}
    >
      {label}
    </a>
  );
}

function AskForLink() {
  const { t } = useI18n();
  const services = useAppServices();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFailure(null);
    void services.auth
      .requestPasswordReset(email.trim())
      .then(() => setSent(true))
      .catch((error: unknown) => {
        /* `no_account` is said plainly rather than hidden behind "if that
           address exists…". The waitlist already reveals as much, and silence
           here leaves somebody who mistyped their own address waiting for a
           mail that is never coming. The route's rate limit is what stops
           this being a directory. */
        setFailure(
          error instanceof ApiError && error.code === "no_account"
            ? "reset_err_no_account"
            : error instanceof ApiError && error.code === "rate_limited"
              ? "auth_err_rate_limited"
              : error instanceof ApiError && error.code === "mail_unavailable"
                ? "reset_err_mail_unavailable"
                : "auth_err_generic",
        );
      })
      .finally(() => setPending(false));
  };

  if (sent) {
    return (
      <AuthScene>
        <div className="grid gap-7">
          <Header title={t("reset_sent_title")} subtitle={t("reset_sent_sub")} />
          <BackToSignIn label={t("reset_back_to_signin")} />
        </div>
      </AuthScene>
    );
  }

  return (
    <AuthScene>
      <div className="grid gap-7">
        <Header title={t("reset_ask_title")} subtitle={t("reset_ask_sub")} />
        <form className="grid gap-5" onSubmit={submit}>
          <PillField label={t("auth_email_label")} error={failure ? t(failure) : undefined}>
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
          <button type="submit" disabled={pending} className={submitClass(pending)} style={submitStyle(pending)}>
            <span>{pending ? t("auth_working") : t("reset_ask_submit")}</span>
          </button>
        </form>
        <BackToSignIn label={t("reset_back_to_signin")} />
      </div>
    </AuthScene>
  );
}

const DEAD_LINK: Record<"expired" | "used" | "unknown", TKey> = {
  expired: "reset_link_expired",
  used: "reset_link_used",
  unknown: "reset_link_unknown",
};

function SetNewPassword() {
  const { t } = useI18n();
  const services = useAppServices();
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<"checking" | "usable" | "expired" | "used" | "unknown">("checking");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<TKey | null>(null);

  /* Read from `window` rather than `useSearchParams`, for the reason
     `Auth.tsx` gives where it reads `?invite=`: the hook would put a prerender
     bailout on the route for a value only a client navigation sets.

     The token is taken straight back out of the address bar. It is a password
     until it is spent, and leaving it there puts it in the history, in a
     shared screen, and in the `Referer` of anything the page later loads. */
  useEffect(() => {
    const url = new URL(window.location.href);
    const fromLink = url.searchParams.get("token")?.trim();
    if (!fromLink) {
      setState("unknown");
      return;
    }
    setToken(fromLink);
    url.searchParams.delete("token");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);

    let cancelled = false;
    void services.auth
      .checkPasswordReset(fromLink)
      .then((result) => {
        if (!cancelled) setState(result);
      })
      .catch(() => {
        // A link that cannot be checked is not a link that should be typed
        // into. Better a clear dead end with a way out than a form that
        // takes a password and then refuses it.
        if (!cancelled) setState("unknown");
      });
    return () => {
      cancelled = true;
    };
  }, [services]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (pending || !token) return;
    // Checked here and nowhere else: the second box exists to catch a typo,
    // and the server is only ever sent one password.
    if (password !== again) {
      setFailure("reset_err_mismatch");
      return;
    }
    setPending(true);
    setFailure(null);
    void services.auth
      .resetPassword(token, password)
      .then(() => setDone(true))
      .catch((error: unknown) => {
        if (error instanceof ApiError && (error.code === "reset_expired" || error.code === "reset_used")) {
          setState(error.code === "reset_expired" ? "expired" : "used");
          return;
        }
        setFailure(
          error instanceof ApiError && error.code === "reset_invalid"
            ? "reset_link_unknown"
            : error instanceof ApiError && error.code === "rate_limited"
              ? "auth_err_rate_limited"
              : "auth_err_generic",
        );
      })
      .finally(() => setPending(false));
  };

  if (done) {
    return (
      <AuthScene>
        <div className="grid gap-7">
          {/* Every other device was signed out. This one was never signed in. */}
          <Header title={t("reset_done_title")} subtitle={t("reset_done_sub")} />
          <a href={SIGN_IN_PATH} className={submitClass(false)} style={{ ...submitStyle(false), textAlign: "center" }}>
            <span>{t("reset_done_cta")}</span>
          </a>
        </div>
      </AuthScene>
    );
  }

  if (state === "checking") {
    return (
      <AuthScene>
        <div className="grid gap-7">
          <Header title={t("reset_set_title")} subtitle={t("reset_checking")} />
        </div>
      </AuthScene>
    );
  }

  if (state !== "usable") {
    return (
      <AuthScene>
        <div className="grid gap-7">
          <Header title={t("reset_dead_title")} subtitle={t(DEAD_LINK[state])} />
          <a href="/forgot" className={submitClass(false)} style={{ ...submitStyle(false), textAlign: "center" }}>
            <span>{t("reset_dead_cta")}</span>
          </a>
          <BackToSignIn label={t("reset_back_to_signin")} />
        </div>
      </AuthScene>
    );
  }

  return (
    <AuthScene>
      <div className="grid gap-7">
        <Header title={t("reset_set_title")} subtitle={t("reset_set_sub")} />
        <form className="grid gap-5" onSubmit={submit}>
          <PillField label={t("reset_new_label")} hint={t("auth_password_hint")}>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                className={`${PILL} focus:border-accent`}
                style={pillStyle}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={10}
                autoComplete="new-password"
                dir="ltr"
                required
              />
            )}
          </PillField>
          <PillField label={t("reset_again_label")} error={failure ? t(failure) : undefined}>
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                aria-describedby={describedBy}
                className={`${PILL} focus:border-accent`}
                style={pillStyle}
                value={again}
                onChange={(event) => setAgain(event.target.value)}
                minLength={10}
                autoComplete="new-password"
                dir="ltr"
                required
              />
            )}
          </PillField>
          <button type="submit" disabled={pending} className={submitClass(pending)} style={submitStyle(pending)}>
            <span>{pending ? t("auth_working") : t("reset_set_submit")}</span>
          </button>
        </form>
      </div>
    </AuthScene>
  );
}
