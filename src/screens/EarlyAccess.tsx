"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { OAuthFailureNotice } from "../components/OAuthFailureNotice";
import { useI18n, type TKey } from "../lib/i18n";
import { SIGN_IN_PATH, SIGN_UP_PATH } from "../runtime/providers/authActions";
import { AuthScene, PILL, PillField } from "./Auth";

/* What a visitor who is not signed in sees while `early_access` is on, on every
   route the app layout serves.

   The code is not checked here. Signup checks it, inside the same transaction
   that creates the account, and a second public endpoint answering "is this a
   real code" would be an oracle for guessing them. So this page only carries
   the code to /signup, where the field arrives filled in and a bad code is
   refused on that field.

   The legal pages stay one click away. They live outside the app layout, so the
   gate never covers them, and eNamad's reviewer has to be able to reach them
   from the front page. */

const LEGAL: { label: TKey; href: string }[] = [
  { label: "lp_footer_terms", href: "/terms" },
  { label: "lp_footer_privacy", href: "/privacy" },
  { label: "lp_footer_refund", href: "/coins" },
  { label: "lp_footer_company", href: "/about" },
  { label: "lp_footer_contact", href: "/contact" },
];

export default function EarlyAccess() {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <AuthScene>
      {/* A social sign-in refused by the invite gate lands back here. */}
      <OAuthFailureNotice />
      <div className="grid gap-7">
        <div className="text-center">
          <h1
            className="text-[clamp(2rem,7vw,2.6rem)] font-extrabold leading-[1.18]"
            style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
          >
            {t("ea_title")}
          </h1>
          <p className="mt-2 text-[15px] font-light leading-[1.9]" style={{ color: "var(--vg-text-muted)" }}>
            {t("ea_sub")}
          </p>
        </div>

        <form
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            router.push(`${SIGN_UP_PATH}?invite=${encodeURIComponent(code.trim())}`);
          }}
        >
          <PillField label={t("auth_invite_label")}>
            {({ id, describedBy }) => (
              <input
                id={id}
                aria-describedby={describedBy}
                className={`${PILL} focus:border-accent`}
                style={{ borderColor: "var(--vg-border)", background: "rgb(255 255 255 / 0.02)", color: "var(--vg-text)" }}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                autoComplete="off"
                dir="ltr"
                required
              />
            )}
          </PillField>
          <button
            type="submit"
            disabled={!code.trim()}
            className="vg-ease w-full rounded-full py-3.5 text-[15px] font-bold enabled:active:scale-[0.99] disabled:cursor-default"
            style={
              code.trim()
                ? { background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }
                : { background: "var(--vg-surface-raised)", color: "var(--vg-text-faint)" }
            }
          >
            {t("ea_submit")}
          </button>
        </form>
      </div>

      <div className="mt-8 flex flex-col items-center gap-6 text-[12.5px]">
        <button
          type="button"
          className="vg-ease hover:text-[color:var(--vg-text)]"
          style={{ color: "var(--vg-accent)" }}
          onClick={() => router.push(SIGN_IN_PATH)}
        >
          {t("auth_to_signin")}
        </button>
        <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2 text-[12px]">
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
    </AuthScene>
  );
}
