import type { ReactNode } from "react";
import { CheckCircle, Info, Warning, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

/**
 * A notice: an icon, a sentence, and — when there is one — the button that
 * fixes it.
 *
 * Ported from Geist's `Note` at the design's request, with its anatomy intact
 * (size scale, `fill` for tinted versus outlined, a bold `label:` prefix, an
 * `action` slot pinned to the inline end) and its palette replaced by ours.
 * None of `--ds-*` came with it: this product's status colours live in
 * `design-system/tokens.css`, and a second set of reds would have been a
 * second design system.
 *
 * It exists because every error in the app was a bare coloured sentence — four
 * of them at three different sizes, one not coloured at all — and none could
 * carry the thing the sentence kept asking for. «کیف پول را شارژ کنید» with no
 * way to reach the wallet is a dead end; `action` is the whole point of moving
 * to this shape.
 *
 * Tones are the five this product distinguishes. Geist ships twelve, but seven
 * of them render identically to `default` here — a variant that cannot be seen
 * is a variant nobody can choose correctly.
 */
export type NoteType = "default" | "success" | "warning" | "error" | "info";

const sizes = {
  small: "min-h-[30px] gap-2 rounded-[9px] px-2 py-1.5 text-[11.5px] leading-[1.7]",
  medium: "min-h-[38px] gap-3 rounded-[9px] px-2.5 py-2 text-[12.5px] leading-[1.75]",
  large: "min-h-[46px] gap-3 rounded-[10px] px-3 py-2.5 text-[13px] leading-[1.75]",
};

/* Text, hairline and wash for each tone. The text colour is the tone itself
   rather than a neutral: every one of these is a light on a dark canvas and
   clears 10:1 on --vg-surface, so the sentence stays as readable as body copy
   while saying what kind of news it is.

   A filled note keeps a hairline, at half the outlined one's weight. Dropping
   it entirely was the first try, and an 8% wash alone disappears the moment the
   note is laid over a card rather than a panel. */
const tones: Record<NoteType, { color: string; border: string; fill: string; fillBorder: string }> = {
  default: {
    color: "var(--vg-text-secondary)",
    border: "var(--vg-border)",
    fill: "var(--vg-surface-overlay)",
    fillBorder: "var(--vg-border-subtle)",
  },
  success: {
    color: "var(--vg-success)",
    border: "var(--vg-success-a30)",
    fill: "var(--vg-success-a08)",
    fillBorder: "var(--vg-success-a15)",
  },
  warning: {
    color: "var(--vg-warning)",
    border: "var(--vg-warning-a30)",
    fill: "var(--vg-warning-a08)",
    fillBorder: "var(--vg-warning-a15)",
  },
  error: { color: "var(--vg-danger)", border: "var(--vg-danger-a30)", fill: "var(--vg-danger-a08)", fillBorder: "var(--vg-danger-a15)" },
  info: { color: "var(--vg-accent)", border: "var(--vg-accent-a20)", fill: "var(--vg-accent-a10)", fillBorder: "var(--vg-accent-a10)" },
};

const ICON_SIZE = { small: 13, medium: 15, large: 16 } as const;

export interface NoteProps {
  size?: keyof typeof sizes | undefined;
  type?: NoteType | undefined;
  /** Tinted background instead of a bare outline. */
  fill?: boolean | undefined;
  /** `true` draws the tone's icon, a string draws «label:» in bold, `false` draws neither. */
  label?: string | boolean | undefined;
  /** The button that resolves it — charge the wallet, upgrade the plan, discard. */
  action?: ReactNode | undefined;
  /** `start` when the message runs to several lines and the icon should stay on the first. */
  align?: "center" | "start" | undefined;
  /**
   * `status` for something that happened while the reader was looking at it —
   * a refused press — and `alert` only for what interrupts. Absent by default:
   * a notice rendered with the page is read in its turn, and announcing it
   * again would be the second reading of the same sentence.
   */
  role?: "status" | "alert" | undefined;
  className?: string | undefined;
  children: ReactNode;
}

export function Note({
  size = "medium",
  type = "default",
  fill = false,
  label = true,
  action,
  align = "center",
  role,
  className,
  children,
}: NoteProps) {
  const tone = tones[type];
  const Icon = type === "success" ? CheckCircle : type === "warning" ? Warning : type === "error" ? WarningCircle : Info;
  return (
    <div
      {...(role ? { role } : {})}
      className={cn(
        "flex w-full justify-between border text-start",
        align === "start" ? "items-start" : "items-center",
        sizes[size],
        className,
      )}
      style={{
        color: tone.color,
        borderColor: fill ? tone.fillBorder : tone.border,
        background: fill ? tone.fill : "transparent",
      }}
    >
      <div
        className={cn(
          "flex min-w-0",
          align === "start" ? "items-start" : "items-center",
          typeof label === "string" ? "gap-1.5" : size === "small" ? "gap-1.5" : "gap-2",
        )}
      >
        {label === true && (
          // Fixed box, so a two-line message does not shift the glyph off the
          // first line the way a shrinking flex child would.
          <span
            className={cn("grid shrink-0 place-items-center", align === "start" && "mt-[3px]")}
            style={{ width: ICON_SIZE[size], height: ICON_SIZE[size] }}
          >
            <Icon size={ICON_SIZE[size]} weight="fill" />
          </span>
        )}
        {typeof label === "string" && <span className="shrink-0 font-semibold whitespace-nowrap">{label}:</span>}
        <span className="min-w-0">{children}</span>
      </div>
      {action}
    </div>
  );
}

/**
 * The default shape for `action`.
 *
 * Neutral rather than tone-coloured: the notice is already saying the news, and
 * a red button beside a red sentence reads as the danger rather than as the way
 * out of it. Sized to sit inside a `small` note without stretching it.
 */
export function NoteAction({
  children,
  onClick,
  href,
  title,
  className,
}: {
  children: ReactNode;
  onClick?: (() => void) | undefined;
  href?: string | undefined;
  title?: string | undefined;
  className?: string | undefined;
}) {
  const classes = cn(
    "grid h-7 shrink-0 cursor-pointer place-items-center rounded-lg px-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors",
    className,
  );
  const style = { background: "var(--vg-surface-overlay)", color: "var(--vg-text)", boxShadow: "inset 0 0 0 1px var(--vg-border)" };
  if (href !== undefined) {
    return (
      <a href={href} title={title} className={classes} style={style}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} title={title} className={classes} style={style}>
      {children}
    </button>
  );
}
