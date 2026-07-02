import { motion } from "framer-motion";
import { House, SquaresFour, ImagesSquare, UsersThree, UserCircle, Plus } from "@phosphor-icons/react";
import { faNum } from "../lib/format";

/** Metaball "blob" brand mark. Gooey filter fuses the three circles. */
export function Logo({ size = 26, animate = false }: { size?: number; animate?: boolean }) {
  const float = (delay: number) =>
    animate
      ? { animate: { translateY: [0, -1.4, 0] }, transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const, delay } }
      : {};
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden style={{ color: "currentColor" }}>
      <defs>
        <filter id="vg-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" />
        </filter>
      </defs>
      <g filter="url(#vg-goo)" fill="currentColor">
        <motion.circle cx="15" cy="16" r="10" {...float(0)} />
        <motion.circle cx="26" cy="22" r="8.5" {...float(0.5)} />
        <motion.circle cx="17.5" cy="27" r="6.5" {...float(1)} />
      </g>
    </svg>
  );
}

export function CreditPill({ coins, onClick }: { coins: number; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-line bg-card2 px-3 py-1.5 transition-transform active:scale-95"
    >
      <span className="text-[13px] leading-none text-ink2">⬡</span>
      <span className="text-[13px] font-medium tabular-nums tracking-wide">{faNum(coins.toLocaleString("en-US"))}</span>
      {onClick && (
        <span className="grid h-4 w-4 place-items-center rounded-full bg-ink/90 text-bg">
          <Plus size={10} weight="bold" />
        </span>
      )}
    </button>
  );
}

/** Soft monochrome ambient glow — the consistent "signature" behind every screen. */
export function Ambient() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
      <div
        className="absolute left-1/2 -translate-x-1/2 -top-32 h-80 w-[140%] rounded-full opacity-60"
        style={{ background: "radial-gradient(closest-side, rgba(255,255,255,0.10), transparent 70%)" }}
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

export type NavKey = "home" | "models" | "community" | "gallery" | "profile";

export function BottomNav({ active, onNav }: { active: NavKey; onNav: (k: NavKey) => void }) {
  const items: { key: NavKey; label: string; Icon: typeof House }[] = [
    { key: "home", label: "خانه", Icon: House },
    { key: "models", label: "مدل‌ها", Icon: SquaresFour },
    { key: "community", label: "کامیونیتی", Icon: UsersThree },
    { key: "gallery", label: "گالری", Icon: ImagesSquare },
    { key: "profile", label: "پروفایل", Icon: UserCircle },
  ];
  return (
    <div className="fixed bottom-0 left-1/2 z-30 w-full max-w-[480px] -translate-x-1/2 border-t border-line bg-surface/85 backdrop-blur-xl">
      <div className="flex items-stretch justify-around px-2 pt-2 pb-[max(14px,env(safe-area-inset-bottom))]">
        {items.map(({ key, label, Icon }) => {
          const on = key === active;
          return (
            <button
              key={key}
              onClick={() => onNav(key)}
              className="flex flex-1 flex-col items-center gap-1 py-1 active:scale-95 transition-transform"
            >
              <Icon size={23} weight={on ? "fill" : "regular"} className={on ? "text-ink" : "text-ink3"} />
              <span className={`text-[10px] ${on ? "text-ink" : "text-ink3"}`}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
