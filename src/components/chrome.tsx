import { motion } from "framer-motion";
import { House, ImagesSquare, UsersThree, UserCircle, Plus } from "@phosphor-icons/react";
import { useI18n } from "../lib/i18n";
import { Mark, Wordmark } from "./brandMarks";
import { BRAND } from "../data/brand";

/** Metaball "blob" brand mark. Gooey filter fuses the three circles. */
/**
 * The mark, where a screen wants the brand as an object rather than a lockup.
 *
 * It used to be three blurred circles gooed together in the old orange — a
 * placeholder from before there was a logo. `animate` gives it the same slow
 * breath it had, which is what the result screen uses while a job runs.
 */
export function Logo({ size = 26, animate = false }: { size?: number; animate?: boolean }) {
  return (
    <motion.span
      className="inline-block"
      style={{ color: "var(--vg-text)" }}
      {...(animate
        ? {
            animate: { scale: [1, 1.04, 1], opacity: [0.85, 1, 0.85] },
            transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const },
          }
        : {})}
    >
      <Mark size={size} />
    </motion.span>
  );
}

/**
 * The credit mark on the generate button: a big four-point spark with a small
 * one at its heel.
 *
 * Not `CreditStar`. The coin is a hexagon outline, and at the size a price sits
 * on a button it stopped being a shape — a 1.7px stroke at 12px is a hint of
 * one. This is filled, and its arms are deliberately fat: the first pass drew a
 * star whose curves pulled deep toward the centre, which is elegant at 40px and
 * a thread at 14, invisible against lime. The waist stays out at 52% of the
 * radius so the arms survive being small.
 *
 * Two of them because one is the button's own «make» mark, and a price wants to
 * read as its own thing rather than as a second copy of that.
 */
export function CreditStar({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden className={`shrink-0 ${className ?? ""}`}>
      <path d="M13.6 2.8C13.6 6.35 17.45 10.2 21 10.2C17.45 10.2 13.6 14.05 13.6 17.6C13.6 14.05 9.75 10.2 6.2 10.2C9.75 10.2 13.6 6.35 13.6 2.8Z" />
      <path d="M6 12.8C6 14.91 8.29 17.2 10.4 17.2C8.29 17.2 6 19.49 6 21.6C6 19.49 3.71 17.2 1.6 17.2C3.71 17.2 6 14.91 6 12.8Z" />
    </svg>
  );
}

export function CreditPill({ coins, onClick }: { coins: number; onClick?: () => void }) {
  const { n } = useI18n();
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line bg-card2 px-3 py-1.5 transition-transform active:scale-95"
    >
      <CreditStar size={13} className="text-ink2" />
      <span className="text-[13px] font-medium tabular-nums tracking-wide">{n(coins)}</span>
      {onClick && (
        <span className="grid h-4 w-4 place-items-center rounded-full bg-ink/90 text-bg">
          <Plus size={10} weight="bold" />
        </span>
      )}
    </button>
  );
}

/** Soft ambient glow + drifting brand blobs — the signature behind every screen.
    The blobs echo the metaball logo: same organism, blown up and slowed down. */
export function Ambient() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div
        className="absolute left-1/2 -translate-x-1/2 -top-32 h-80 w-[140%] rounded-full opacity-60"
        style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.10), transparent 70%)" }}
      />
      <motion.div
        className="absolute -right-24 top-44 h-80 w-80 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(255,92,0,0.10), transparent 70%)" }}
        animate={{ y: [0, -26, 0], x: [0, -12, 0] }}
        transition={{ duration: 17, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -left-20 top-[58%] h-72 w-72 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(255,92,0,0.07), transparent 70%)" }}
        animate={{ y: [0, 22, 0] }}
        transition={{ duration: 21, repeat: Infinity, ease: "easeInOut" }}
      />
      <div
        className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}

export type NavKey = "home" | "community" | "gallery" | "profile";

function NavTab({ label, Icon, on, onClick }: { label: string; Icon: typeof House; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-1 flex-col items-center gap-1 py-1 transition-transform active:scale-95">
      <Icon size={23} weight={on ? "fill" : "regular"} className={on ? "text-accent" : "text-ink3"} />
      <span className={`text-[10px] ${on ? "text-accent" : "text-ink3"}`}>{label}</span>
    </button>
  );
}

/* ---------- desktop chrome -------------------------------------------------
   Built from stitch-export/mobile/vgen-studio-desktop-persian-refined.html:
   a 64px bar over a 280px rail on the inline start, content filling the rest.
   Both numbers are tokens (--vg-nav-height, --vg-sidebar-width) — the system
   anticipated this layout even though nothing had used it yet.

   A bottom tab bar is phone furniture. Left on a 1440px window it strands five
   targets in the middle of the screen with 1200px of dead space above them, so
   the two swap at `md` and every screen inherits the right one.
   ---------------------------------------------------------------------------- */

const NAV_ITEMS: { key: NavKey; Icon: typeof House; label: TabLabel }[] = [
  { key: "home", Icon: House, label: "nav_home" },
  { key: "community", Icon: UsersThree, label: "nav_community" },
  { key: "gallery", Icon: ImagesSquare, label: "nav_gallery" },
  { key: "profile", Icon: UserCircle, label: "nav_profile" },
];

type TabLabel = "nav_home" | "nav_community" | "nav_gallery" | "nav_profile";

export function SideNav({
  active,
  onNav,
  onCreate,
  coins,
  onWallet,
}: {
  active: NavKey;
  onNav: (k: NavKey) => void;
  onCreate: () => void;
  coins: number;
  onWallet: () => void;
}) {
  const { t, n } = useI18n();
  return (
    <aside
      className="fixed inset-y-0 z-40 hidden flex-col border-e md:flex"
      style={{
        insetInlineStart: 0,
        inlineSize: "var(--vg-sidebar-width)",
        background: "var(--vg-surface)",
        borderColor: "var(--vg-border-subtle)",
      }}
    >
      <div className="flex h-16 items-center px-5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
        <span style={{ color: "var(--vg-text)" }}>
          <Wordmark height={20} title={BRAND.name} />
        </span>
      </div>

      <div className="p-4">
        <button onClick={onCreate} className="vg-btn vg-btn--primary w-full">
          <Plus size={17} weight="bold" />
          {t("nav_create")}
        </button>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ key, Icon, label }) => {
          const on = active === key;
          return (
            <button
              key={key}
              onClick={() => onNav(key)}
              aria-current={on ? "page" : undefined}
              className="flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] transition-colors"
              style={{
                background: on ? "var(--vg-surface-overlay)" : "transparent",
                color: on ? "var(--vg-primary)" : "var(--vg-text-muted)",
              }}
            >
              <Icon size={20} weight={on ? "fill" : "regular"} />
              {t(label)}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-4">
        <button
          onClick={onWallet}
          className="flex w-full items-center justify-between rounded-md px-3.5 py-3"
          style={{ background: "var(--vg-surface-raised)", border: "1px solid var(--vg-border-subtle)" }}
        >
          <span className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
            <CreditStar size={14} />
            {t("w_balance")}
          </span>
          <span className="vg-numeric text-[13.5px]" style={{ color: "var(--vg-text)" }}>
            {n(coins)}
          </span>
        </button>
      </div>
    </aside>
  );
}

export function BottomNav({ active, onNav, onCreate }: { active: NavKey; onNav: (k: NavKey) => void; onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t border-line bg-surface/85 backdrop-blur-xl md:hidden">
      <div className="flex items-end justify-around px-1.5 pt-2 pb-[max(14px,env(safe-area-inset-bottom))]">
        <NavTab label={t("nav_home")} Icon={House} on={active === "home"} onClick={() => onNav("home")} />
        <NavTab label={t("nav_community")} Icon={UsersThree} on={active === "community"} onClick={() => onNav("community")} />
        <div className="flex flex-1 justify-center">
          <button
            onClick={onCreate}
            aria-label={t("nav_create")}
            className="grid h-14 w-14 -translate-y-3.5 place-items-center rounded-full transition-transform active:scale-95"
            style={{ background: "var(--color-accent)", color: "var(--color-on-accent)", boxShadow: "var(--shadow-accent)" }}
          >
            <Plus size={26} weight="bold" />
          </button>
        </div>
        <NavTab label={t("nav_gallery")} Icon={ImagesSquare} on={active === "gallery"} onClick={() => onNav("gallery")} />
        <NavTab label={t("nav_profile")} Icon={UserCircle} on={active === "profile"} onClick={() => onNav("profile")} />
      </div>
    </div>
  );
}
