import { CoinMark } from "./chrome";
import { AccountMenu, type AccountMenuData } from "./AccountMenu";
import { MegaMenu } from "./MegaMenu";
import type { NavMenus } from "./navMenu";
import { useI18n, type TKey } from "../lib/i18n";
import { useEdgeFade } from "../lib/useEdgeFade";
import { useMediaQuery } from "../lib/useMediaQuery";
import { BRAND } from "../data/brand";

/* ---------------------------------------------------------------------------
   The 44px bar, modelled on Higgsfield.

   The reference has no sidebar. It runs one 44px row carrying every surface the
   product owns, and the row scrolls horizontally rather than collapsing into a
   hamburger — nothing is ever more than one click away.

   The bigger borrowing is what the items *are*. VGen's nav was
   home/community/gallery/profile, which describes the app's structure. This one
   is explore/image/video/audio, which describes what the user came to make. The
   user's question on arrival is "what am I building", not "where in the app am I".

   ## The menus

   image, video and audio open a panel of the models that answer to them, built
   from the served catalogue in `navMenu.ts`. The reference does the same thing
   and it is the reason its bar is worth copying: a visitor who has heard of Veo
   picks Veo, and a nav that only says "video" makes them find it themselves.

   **Only above `md`.** Two reasons, and the first is not taste: this row is a
   horizontal scroller, and `overflow-x: auto` clips a panel that hangs out of
   it. The container drops to `overflow-visible` at the width where the seven
   items fit without scrolling, which is the same width where three columns of
   models are readable at all. Below it every item stays exactly what it was.
   --------------------------------------------------------------------------- */

/** `community` and `mcp` are routable but deliberately absent from ITEMS below.
 *  Both are reached from Explore — the community CTA and the MCP tile — and a
 *  seven-item bar is already at the edge of what a phone scrolls comfortably.
 *  MCP earns a nav item the day it actually works. */
export type NavKey = "explore" | "image" | "video" | "audio" | "effects" | "academy" | "gallery" | "community" | "mcp";

/**
 * `label` is fa copy inline, except for the three that also appear in the
 * landing page's own header — those go through `t()` because that header is
 * bilingual, and two spellings of "ویدیو" in two bars is a drift waiting to
 * happen. The rest are untranslated here as they were; this bar is fa-only
 * today and moving all of it is a separate change.
 */
const ITEMS: { key: NavKey; label: string; labelKey?: TKey; badge?: string }[] = [
  { key: "explore", label: "اکسپلور" },
  { key: "image", label: "تصویر", labelKey: "nav_image" },
  { key: "video", label: "ویدیو", labelKey: "nav_video" },
  { key: "audio", label: "صدا", labelKey: "nav_audio" },
  { key: "effects", label: "افکت‌ها" },
  { key: "academy", label: "آکادمی", badge: "جدید" },
  { key: "gallery", label: "کارهای من" },
];

export function TopBar({
  active,
  onNav,
  menus,
  onOpenModel,
  coins,
  account,
  onWallet,
  onProfile,
  onSignIn,
}: {
  active: NavKey;
  onNav: (k: NavKey) => void;
  /** Built from the catalogue by the layout, so this stays a pure component. */
  menus: NavMenus;
  onOpenModel: (familyId: string) => void;
  /** Null for a visitor: there is no wallet until there is an account. */
  coins: number | null;
  /** Everything the account menu needs, assembled by the layout for the same
   *  reason `menus` is — this component stays renderable without providers. */
  account: AccountMenuData;
  onWallet: () => void;
  onProfile: () => void;
  /** Shown instead of the balance and the avatar when nobody is signed in. */
  onSignIn: () => void;
}) {
  const { t, c } = useI18n();
  const edge = useEdgeFade<HTMLElement>();
  const wide = useMediaQuery("(min-width: 768px)");

  return (
    <header
      className="sticky z-40 w-full"
      style={{
        // Not `top-0`: a site banner sits above this and publishes its height.
        // The fallback is what every page without one gets.
        top: "var(--vg-banner-height, 0px)",
        background: "var(--vg-canvas)",
        borderBlockEnd: "1px solid var(--vg-border-subtle)",
      }}
    >
      <div className="mx-auto flex h-11 max-w-[var(--vg-container-max)] items-center gap-3 px-4 md:px-6">
        {/* Wordmark leads the row. In RTL that puts it on the right, which is
            where the reference puts it in LTR — the same position, mirrored. */}
        <button
          onClick={() => onNav("explore")}
          className="shrink-0 text-[17px] font-light tracking-[0.34em]"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          {BRAND.name}
        </button>

        {/* hide-scrollbar: the row is meant to scroll on narrow viewports, but a
            visible bar inside a 44px chrome element reads as a rendering fault.

            The bar staying hidden is fine; the row saying nothing was not. At
            375px this strip gets 175px and holds three of seven destinations —
            افکت‌ها, آکادمی and کارهای من were entirely off the edge with no hint
            they existed. A mask fades whichever edge still has content behind
            it, so the row reads as continuing rather than ending.

            `md:overflow-visible` is what lets a menu hang below the bar: a
            scroll container clips its descendants on both axes, so at the
            widths where menus open the row must stop being one. */}
        <nav
          ref={edge.ref}
          onScroll={edge.onScroll}
          className={`hide-scrollbar -mx-1 min-w-0 flex-1 overflow-x-auto px-1 md:overflow-x-visible ${
            edge.more ? "vg-fade-end" : ""
          } ${edge.atStart ? "vg-fade-start" : ""}`}
        >
          <ul className="flex items-center gap-0.5">
            {ITEMS.map(({ key, label, labelKey, badge }) => {
              const on = active === key;
              const menu = menus[key];
              const text = labelKey ? t(labelKey) : label;

              if (wide && menu)
                return (
                  <MegaMenu
                    key={key}
                    label={text}
                    badge={badge}
                    menu={menu}
                    active={on}
                    onOpenModel={onOpenModel}
                    onNav={() => onNav(key)}
                  />
                );

              return (
                <li key={key} className="shrink-0">
                  <button
                    onClick={() => onNav(key)}
                    aria-current={on ? "page" : undefined}
                    className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[13px] transition-colors"
                    style={{
                      color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                      background: on ? "var(--vg-primary-a14)" : "transparent",
                    }}
                  >
                    {text}
                    {/* A badge in the nav is a growth tool, not decoration — the
                        reference marks every surface it wants traffic on. */}
                    {badge && (
                      <span
                        className="rounded px-1 py-px text-[9.5px] font-bold"
                        style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
                      >
                        {badge}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* A visitor gets one control where an account gets two. Showing a
            balance of nothing, or an avatar for nobody, would both be answers
            to a question they have not been asked yet. */}
        {coins === null ? (
          <button
            onClick={onSignIn}
            className="vg-tap shrink-0 rounded-lg px-3 py-1 text-[12.5px] font-bold"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            {t("nav_sign_in")}
          </button>
        ) : (
          <>
            <button
              onClick={onWallet}
              /* Through i18n, and `c()` rather than `n()`. The label was Persian
                 inlined, so it stayed Persian in English mode; and coins bill in
                 hundredths, which the plain number formatter reports to three
                 decimals — a third digit that can only be float noise. */
              aria-label={`${t("w_balance")}: ${c(coins)} ${t("p_coins")} — ${t("p_wallet")}`}
              className="vg-tap flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-colors"
              style={{ background: "rgba(255,255,255,0.05)" }}
            >
              <CoinMark size={13} />
              <span className="vg-numeric text-[12.5px]">{c(coins)}</span>
            </button>

            {/* A menu, not a second link to /profile.
                The avatar used to navigate and nothing else, so the balance and
                the way to top it up were two screens apart — and it painted a
                literal "م" for every account, whoever was signed in. */}
            <AccountMenu {...account} onProfile={onProfile} onWallet={onWallet} />
          </>
        )}
      </div>
    </header>
  );
}
