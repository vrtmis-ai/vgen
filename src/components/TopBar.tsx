import { CoinMark } from "./chrome";
import { useI18n } from "../lib/i18n";
import { useEdgeFade } from "../lib/useEdgeFade";
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
   --------------------------------------------------------------------------- */

/** `community` and `mcp` are routable but deliberately absent from ITEMS below.
 *  Both are reached from Explore — the community CTA and the MCP tile — and a
 *  seven-item bar is already at the edge of what a phone scrolls comfortably.
 *  MCP earns a nav item the day it actually works. */
export type NavKey = "explore" | "image" | "video" | "audio" | "effects" | "academy" | "gallery" | "community" | "mcp";

const ITEMS: { key: NavKey; label: string; badge?: string }[] = [
  { key: "explore", label: "اکسپلور" },
  { key: "image", label: "تصویر" },
  { key: "video", label: "ویدیو" },
  { key: "audio", label: "صدا" },
  { key: "effects", label: "افکت‌ها" },
  { key: "academy", label: "آکادمی", badge: "جدید" },
  { key: "gallery", label: "کارهای من" },
];

export function TopBar({
  active,
  onNav,
  coins,
  onWallet,
  onProfile,
}: {
  active: NavKey;
  onNav: (k: NavKey) => void;
  coins: number;
  onWallet: () => void;
  onProfile: () => void;
}) {
  const { n } = useI18n();
  const edge = useEdgeFade<HTMLElement>();
  return (
    <header
      className="sticky top-0 z-40 w-full"
      style={{ background: "var(--vg-canvas)", borderBlockEnd: "1px solid var(--vg-border-subtle)" }}
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
            it, so the row reads as continuing rather than ending. */}
        <nav
          ref={edge.ref}
          onScroll={edge.onScroll}
          className={`hide-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1 ${
            edge.more ? "vg-fade-end" : ""
          } ${edge.atStart ? "vg-fade-start" : ""}`}
        >
          {ITEMS.map(({ key, label, badge }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => onNav(key)}
                aria-current={on ? "page" : undefined}
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-[13px] transition-colors"
                style={{
                  color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                  background: on ? "var(--vg-primary-a14)" : "transparent",
                }}
              >
                {label}
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
            );
          })}
        </nav>

        <button
          onClick={onWallet}
          aria-label={`موجودی: ${n(coins)} سکه — شارژ`}
          className="vg-tap flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <CoinMark size={13} />
          <span className="vg-numeric text-[12.5px]">{n(coins)}</span>
        </button>

        <button
          onClick={onProfile}
          aria-label="پروفایل"
          className="vg-tap grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
          style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
        >
          م
        </button>
      </div>
    </header>
  );
}
