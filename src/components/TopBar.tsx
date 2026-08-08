import { CoinMark } from "./chrome";
import { useI18n } from "../lib/i18n";

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

export type NavKey = "explore" | "image" | "video" | "audio" | "gallery";

const ITEMS: { key: NavKey; label: string }[] = [
  { key: "explore", label: "اکسپلور" },
  { key: "image", label: "تصویر" },
  { key: "video", label: "ویدیو" },
  { key: "audio", label: "صدا" },
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
          className="shrink-0 text-[17px] font-extrabold tracking-tight"
          style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
        >
          VGen
        </button>

        {/* hide-scrollbar: the row is meant to scroll on narrow viewports, but a
            visible bar inside a 44px chrome element reads as a rendering fault. */}
        <nav className="hide-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto px-1">
          {ITEMS.map(({ key, label }) => {
            const on = active === key;
            return (
              <button
                key={key}
                onClick={() => onNav(key)}
                aria-current={on ? "page" : undefined}
                className="shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1 text-[13px] transition-colors"
                style={{
                  color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                  background: on ? "rgba(233,95,24,0.10)" : "transparent",
                }}
              >
                {label}
              </button>
            );
          })}
        </nav>

        <button
          onClick={onWallet}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 transition-colors"
          style={{ background: "rgba(255,255,255,0.05)" }}
        >
          <CoinMark size={13} />
          <span className="vg-numeric text-[12.5px]">{n(coins)}</span>
        </button>

        <button
          onClick={onProfile}
          aria-label="پروفایل"
          className="grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold"
          style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
        >
          م
        </button>
      </div>
    </header>
  );
}
