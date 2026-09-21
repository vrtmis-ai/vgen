import { useState, type ComponentPropsWithoutRef } from "react";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import { useI18n } from "../lib/i18n";

/**
 * A password field you can read back.
 *
 * Sign-in and sign-up asked for a password with no way to see what had been
 * typed. On a phone keyboard, in a script that is not the one the keyboard
 * usually writes, that is how an account gets created with a password its
 * owner cannot type a second time — and the only signal is a failed sign-in
 * later, with nothing to say which character was wrong.
 *
 * The toggle sits on the inline end, which in Persian is the left: the side a
 * trailing control lives on in this layout. The field itself stays `dir="ltr"`
 * (a password is a string, read the same way in both languages) and keeps
 * centred text, so it takes equal padding on both sides to stay centred and
 * clear of the button.
 *
 * `onMouseDown` prevents the default so that clicking the eye does not take
 * focus out of the field — you look, and carry on typing. From the keyboard it
 * is an ordinary button: Tab to it, Space to toggle, and focus stays on it,
 * which is where a keyboard user expects it to be.
 */
export function PasswordInput({ className = "", style, ...input }: Omit<ComponentPropsWithoutRef<"input">, "type">) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const label = visible ? t("auth_password_hide") : t("auth_password_show");

  return (
    <div className="relative">
      <input {...input} type={visible ? "text" : "password"} className={className} style={{ ...style, paddingInline: "3rem" }} />
      <button
        type="button"
        onClick={() => setVisible((shown) => !shown)}
        onMouseDown={(event) => event.preventDefault()}
        aria-label={label}
        aria-pressed={visible}
        aria-controls={input.id}
        title={label}
        className="vg-tap absolute top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full transition-colors hover:bg-white/5"
        style={{ insetInlineEnd: "0.5rem", color: visible ? "var(--vg-text)" : "var(--vg-text-muted)" }}
      >
        {visible ? <EyeSlash size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}
