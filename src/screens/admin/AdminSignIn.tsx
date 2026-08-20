import { useState, type FormEvent } from "react";
import { ApiError } from "../../runtime/apiError";
import type { AdminApi } from "../../features/admin/adminApi";
import { useAdminSignIn } from "../../features/admin/useAdmin";
import type { AdminSessionState } from "../../runtime/contracts/admin";

/**
 * Two steps, because the server has two.
 *
 * `POST /admin/session` answers 202 `mfa_required` and sets a cookie that
 * authorises nothing; only `POST /admin/session/mfa` turns it into a session
 * that can call anything. This screen never decides which step it is on — the
 * server's `status` does — so a reload in the middle lands back where the
 * session actually is rather than at the start.
 *
 * The password step deliberately reports nothing useful about failure. The
 * endpoint answers the same 404 for a wrong password, an unknown address and a
 * real customer's address, so that it cannot be used to find out who is staff.
 * A message here that distinguished them would give away what the endpoint
 * refuses to.
 */
export function AdminSignIn({ api, session }: { api: AdminApi; session: AdminSessionState | null }) {
  const { password, secondFactor } = useAdminSignIn(api);
  const [email, setEmail] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");

  const awaitingSecondFactor = session?.status === "mfa_required";

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    password.mutate({ email: email.trim(), password: secret });
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    secondFactor.mutate(code.trim());
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[380px] flex-col justify-center px-5">
      <h1 className="text-[19px] font-extrabold" style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}>
        ورود کارکنان
      </h1>
      <p className="mt-1 text-[12.5px]" style={{ color: "var(--vg-text-faint)" }}>
        {awaitingSecondFactor ? "کد شش‌رقمی برنامه‌ی احرازهویت را وارد کن." : "این صفحه برای مشتری‌ها نیست."}
      </p>

      {awaitingSecondFactor ? (
        <form onSubmit={submitCode} className="mt-5 flex flex-col gap-2.5">
          <input
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="کد تأیید دومرحله‌ای"
            placeholder="۱۲۳۴۵۶"
            className="h-10 rounded-lg px-3 text-[13px] tracking-[0.3em] outline-none"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
          />
          <SubmitButton busy={secondFactor.isPending} label="تأیید" />
          {secondFactor.error ? <Problem error={secondFactor.error} /> : null}
        </form>
      ) : (
        <form onSubmit={submitPassword} className="mt-5 flex flex-col gap-2.5">
          <input
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="username"
            aria-label="ایمیل"
            placeholder="email"
            dir="ltr"
            className="h-10 rounded-lg px-3 text-[13px] outline-none"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
          />
          <input
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            type="password"
            autoComplete="current-password"
            aria-label="گذرواژه"
            placeholder="password"
            dir="ltr"
            className="h-10 rounded-lg px-3 text-[13px] outline-none"
            style={{ background: "var(--vg-surface)", color: "var(--vg-text)", border: "1px solid var(--vg-border-subtle)" }}
          />
          <SubmitButton busy={password.isPending} label="ادامه" />
          {password.error ? <Problem error={password.error} /> : null}
        </form>
      )}
    </div>
  );
}

function SubmitButton({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="h-10 rounded-lg text-[13px] font-bold disabled:opacity-60"
      style={{ background: "var(--vg-primary-a18)", color: "var(--vg-primary-soft)", border: "1px solid var(--vg-border-subtle)" }}
    >
      {busy ? "…" : label}
    </button>
  );
}

/**
 * Branches on `code`, never on the message — codes are the contract, messages
 * are prose. Only two of these are worth naming: not being enrolled is the one
 * failure a person can actually act on, and a wrong second factor is the one
 * they will hit by mistyping.
 */
function Problem({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : "";
  const message =
    code === "mfa_not_enrolled"
      ? "این حساب دومرحله‌ای ندارد. تا وقتی ثبت نشود، هیچ نشستی ساخته نمی‌شود."
      : code === "mfa_invalid"
        ? "کد درست نیست."
        : "ورود ناموفق بود.";
  return (
    <p role="alert" className="text-[12px]" style={{ color: "var(--vg-danger, #ff6c52)" }}>
      {message}
    </p>
  );
}
