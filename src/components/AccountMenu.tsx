"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CaretLeft, Globe, ImagesSquare, SignOut, Sparkle, User } from "@phosphor-icons/react";
import { CoinMark } from "./chrome";
import { useI18n } from "../lib/i18n";
import { EASE_OUT } from "../lib/motion";

/* ---------------------------------------------------------------------------
   The account menu, hung off the avatar in the bar.

   Adapted from a kokonut profile dropdown. What was worth taking is the shape:
   identity at the top, labelled rows with a value on the trailing side, and the
   sign-out separated at the bottom rather than sitting in the list as a peer of
   "language".

   Five things could not come across, and each is a constraint rather than a
   preference:

   1. THE TRIGGER IS THE AVATAR ALONE. The original's trigger is a three-line
      card — name, email, 40px image, `p-3`. This bar is 44px tall. The name and
      the address moved inside the panel, which is where they were always more
      useful: they identify *which* account the actions below belong to, and on
      the bar they would only repeat what the avatar already says.

   2. NO RADIX. The original imports a dropdown primitive this project does not
      have and does not need one for: open, Escape, click-away and focus-out are
      the same handful of lines `MegaMenu` already carries, and a dependency
      added for one menu is a dependency to keep forever.

   3. TOKENS. `bg-white dark:bg-zinc-900`, a purple-to-orange avatar ring, blue
      and purple value chips, `red-500` — five palettes from three systems, none
      of them ours. The one that survives is the sign-out, because `--vg-danger`
      exists for exactly that.

   4. LOGICAL PROPERTIES. `-right-3`, `text-left`, `ml-auto` and `align="end"`
      all pin to the visual left or right, which under RTL is the wrong end of
      the trigger.

   5. NO DECORATIVE SQUIGGLE. The original hangs a small bending line off the
      trigger to point at the menu. It points the wrong way under RTL, and a
      panel that opens under the thing you pressed does not need an arrow
      explaining that it did.

   The balance sits above the rows rather than in them. It is the only figure on
   this menu somebody acts on, and the reference's own pattern — a value chip on
   the trailing side of a row — makes it a fact to read rather than a thing to
   press.
   --------------------------------------------------------------------------- */

/**
 * Everything the menu needs that the bar does not already hold.
 *
 * Named so `TopBar` can take it as one prop: it already carries `onProfile` and
 * `onWallet` for its own controls, and threading five more through it one at a
 * time would make the bar's signature about this menu.
 */
export interface AccountMenuData {
  name: string;
  email?: string | undefined;
  coins: number;
  /** What those coins are a remainder of — the buckets the wallet holds, summed. */
  coinsGranted: number;
  /** What the account is on today. Null while the API cannot say. */
  planLabel: string | null;
  galleryCount: number;
  onGallery: () => void;
  onToggleLang: () => void;
  onSignOut: () => void;
}

export function AccountMenu({
  name,
  email,
  coins,
  coinsGranted,
  planLabel,
  galleryCount,
  onProfile,
  onWallet,
  onGallery,
  onToggleLang,
  onSignOut,
}: AccountMenuData & { onProfile: () => void; onWallet: () => void }) {
  const { t, c, n, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  const close = useCallback(() => setOpen(false), []);

  /* Null when the wallet holds no grants — a real state, and one where a ring
     would be claiming something. See lib/credits. */
  const ratio = coinsGranted > 0 ? Math.min(1, Math.max(0, coins / coinsGranted)) : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node | null)) close();
    };
    document.addEventListener("keydown", onKey);
    // `pointerdown`, not `click`: a click that starts inside the panel and ends
    // outside it — a drag over a row — would otherwise close the menu under the
    // finger that was still on it.
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  const act = (run: () => void) => () => {
    close();
    run();
  };

  return (
    <div
      ref={wrap}
      className="relative shrink-0"
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        /* The ring is a picture of the same figure, so the label carries it in
           words — a screen reader gets the balance, not "menu". */
        aria-label={ratio === null ? t("acct_menu") : `${t("acct_menu")} — ${c(coins)} ${t("acct_of")} ${c(coinsGranted)} ${t("p_coins")}`}
        className="vg-tap grid size-8 shrink-0 place-items-center rounded-full p-[1.5px]"
        /* A conic gradient, not an SVG arc: one declaration, no viewBox to keep
           in step with a 32px box, and it costs nothing to animate later.
           Clockwise from twelve in both directions — a depleting ring reads as a
           clock, and clocks do not mirror with the text. */
        style={{
          background:
            ratio === null ? "var(--vg-border-subtle)" : `conic-gradient(var(--vg-primary) ${ratio * 360}deg, var(--vg-border-strong) 0)`,
        }}
      >
        {/* The disc never takes the ring's colour.
            Tinting it on open merged the two into one filled circle, so pressing
            the avatar replaced the reading with a green blob — the opposite of
            what the ring is for. Open is carried by the initial brightening and
            by `aria-expanded`; the panel appearing is the rest of the answer. */}
        <span
          className="grid size-full place-items-center rounded-full text-[11px] font-semibold transition-colors"
          style={{
            background: "var(--vg-surface-overlay)",
            color: open ? "var(--vg-text)" : "var(--vg-text-muted)",
          }}
        >
          {name.slice(0, 1)}
        </span>
      </button>

      {open && (
        <div className="absolute top-full z-50 pt-2" style={{ insetInlineEnd: 0 }}>
          <motion.div
            id={panelId}
            role="menu"
            aria-label={t("acct_menu")}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0.12 : 0.18, ease: EASE_OUT }}
            className="w-[264px] overflow-hidden"
            style={{
              background: "var(--vg-surface-overlay)",
              border: "1px solid var(--vg-border-subtle)",
              borderRadius: "var(--vg-radius-lg)",
              boxShadow: "var(--vg-shadow-modal)",
            }}
          >
            {/* Which account these actions belong to. */}
            <div className="px-3.5 pb-3 pt-3.5">
              <div className="truncate text-[13px] font-bold" style={{ color: "var(--vg-text)" }}>
                {name}
              </div>
              {email && (
                <div dir="ltr" className="truncate text-start text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
                  {email}
                </div>
              )}
            </div>

            {/* The balance, and the one thing on this menu worth pressing. */}
            <div className="mx-3.5 mb-2 rounded-xl p-3" style={{ background: "var(--vg-deep)" }}>
              <div className="text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                {t("w_balance")}
              </div>
              <div className="mt-1 flex items-baseline gap-1.5">
                <CoinMark size={15} />
                {/* c(), not n(): coins bill in hundredths, and the plain number
                    formatter would print a third decimal that is float noise. */}
                <span className="vg-numeric text-[19px] font-semibold tabular-nums" style={{ color: "var(--vg-text)" }}>
                  {c(coins)}
                </span>
                {/* A balance alone says nothing about how much of the month is
                    left. The denominator is the buckets this wallet holds,
                    summed — and it is dropped rather than faked when there are
                    none. */}
                {ratio !== null && (
                  <span className="vg-numeric text-[11px] tabular-nums" style={{ color: "var(--vg-text-faint)" }}>
                    {t("acct_of")} {c(coinsGranted)}
                  </span>
                )}
                <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                  {t("p_coins")}
                </span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={act(onWallet)}
                className="vg-tap mt-2.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg text-[12px] font-bold"
                style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
              >
                <Sparkle size={13} weight="fill" />
                {t("p_wallet")}
              </button>
            </div>

            <div style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
              <MenuRow icon={<User size={16} weight="fill" />} label={t("nav_profile")} onClick={act(onProfile)} />
              <MenuRow
                icon={<Sparkle size={16} weight="fill" />}
                label={t("acct_plan")}
                /* Null while `GET /plans` cannot say which one is active — the
                   plans screen makes the same call and for the same reason. */
                value={planLabel ?? t("pl_no_plan_title")}
                muted={planLabel === null}
              />
              <MenuRow
                icon={<ImagesSquare size={16} weight="fill" />}
                label={t("p_gallery")}
                value={`${n(galleryCount)} ${t("p_items")}`}
                onClick={act(onGallery)}
              />
              <MenuRow
                icon={<Globe size={16} />}
                label={t("p_lang")}
                value={lang === "fa" ? "فارسی" : "English"}
                onClick={act(onToggleLang)}
              />
            </div>

            {/* Separated, because signing out is not a peer of changing the
                language and a list that treats it as one invites the misclick. */}
            <div className="p-2" style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
              <button
                type="button"
                role="menuitem"
                onClick={act(onSignOut)}
                className="vg-tap flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[12.5px] font-semibold transition-colors"
                style={{ color: "var(--vg-danger)" }}
              >
                <SignOut size={16} />
                {t("p_logout")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/**
 * One row. A button when it does something, a plain div when it only reports —
 * a disabled button still announces itself as a control that could have been
 * pressed, which is what the profile screen's dead rows already get wrong.
 */
function MenuRow({
  icon,
  label,
  value,
  muted = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  muted?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg"
        style={{ background: "var(--vg-glass-light)", color: "var(--vg-text-muted)" }}
      >
        {icon}
      </span>
      <span className="flex-1 truncate text-start text-[12.5px]" style={{ color: "var(--vg-text-secondary)" }}>
        {label}
      </span>
      {value && (
        <span className="shrink-0 text-[11px]" style={{ color: muted ? "var(--vg-text-faint)" : "var(--vg-text-muted)" }}>
          {value}
        </span>
      )}
      {onClick && <CaretLeft size={12} aria-hidden className="shrink-0 ltr:-scale-x-100" style={{ color: "var(--vg-text-faint)" }} />}
    </>
  );

  if (!onClick) return <div className="flex w-full items-center gap-2.5 px-3.5 py-2.5">{body}</div>;

  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 transition-colors">
      {body}
    </button>
  );
}
