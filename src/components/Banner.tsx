"use client";

import { useEffect, useState, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { useI18n } from "../lib/i18n";
import { readStoredValue, writeStoredValue } from "../adapters/browser/storage";
import { z } from "zod";

/* ---------------------------------------------------------------------------
   The strip above everything.

   Adapted from the pasted fumadocs banner. What survived: the dismissal that
   remembers itself, the rainbow variant's moving gradient, and publishing its
   own height so the layout can make room. What changed, and why:

   - **Tokens, not `bg-fd-secondary` / `text-fd-muted-foreground`.** Those name
     a different design system's variables and would render unstyled here.

   - **`writeStoredValue`, not `localStorage.setItem`.** The repo has a storage
     port that versions what it writes and swallows a blocked-storage throw;
     Safari in private mode throws on `setItem`, and an uncaught one here would
     take down the top of every page.

   - **No `dangerouslySetInnerHTML` pre-hydration script.** The reference injects
     one to hide a dismissed banner before React runs. This app paints
     `AppLoading` until the plan ladder and the catalogue arrive, so there is no
     first paint for a dismissed banner to flash in.

   - **The gradient angle is mirrored under RTL.** `repeating-linear-gradient`
     takes a physical angle, so at 70deg the flow ran the opposite way to the
     text. Same class of bug the hero's logo slider had, same fix.
   --------------------------------------------------------------------------- */

export type BannerVariant = "rainbow" | "normal";

/** Only the shape we write, so a hand-edited value cannot resurrect as `true`. */
const DismissedSchema = z.boolean();

const storageKey = (id: string) => `vg-banner-${id}`;

export function Banner({
  id,
  variant = "normal",
  height = "2.75rem",
  rainbowColors,
  onClick,
  onHold,
  label,
  children,
}: {
  /**
   * Identifies the dismissal, so it has to change when the message does.
   *
   * A campaign passes its own id: dismissing March's festival must not silently
   * swallow April's. Anything with a fixed id is dismissed once and for good.
   */
  id: string;
  variant?: BannerVariant;
  height?: string;
  rainbowColors?: string[];
  /** The whole strip is the target. A banner nobody can click is an ornament. */
  onClick?: () => void;
  /**
   * Told when a pointer or focus is inside, so a rotating caller can stop
   * rotating. WCAG 2.2.2 wants a way to pause anything that moves on its own,
   * and hovering the thing you are reading is the one people actually perform.
   */
  onHold?: (held: boolean) => void;
  /** Names the region when the content changes on its own. */
  label?: string | undefined;
  children: ReactNode;
}) {
  const { t, lang } = useI18n();
  // Open until proven otherwise, and the check runs in an effect because
  // localStorage is not there during the server render.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOpen(!readStoredValue(storageKey(id), DismissedSchema, false));
  }, [id]);

  /**
   * Publish the height so the bars below can move down.
   *
   * Both of them sit at the top of the viewport — the app's TopBar is sticky,
   * the landing page's nav is fixed — so neither leaves room for anything above
   * it on its own. They read `--vg-banner-height`, which is `0px` whenever this
   * is not rendering.
   */
  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.style.setProperty("--vg-banner-height", height);
    return () => {
      // Braced: removeProperty returns the old value, and an arrow that returns
      // it hands React a string where it wants a cleanup function.
      root.style.removeProperty("--vg-banner-height");
    };
  }, [open, height]);

  if (!open) return null;

  const rainbow = variant === "rainbow";

  return (
    <div
      // `aria-live="off"`: the strip rotates on a timer, and announcing each
      // turn would interrupt whatever a screen-reader user is actually doing.
      // The region and its label are how they reach it on their own terms.
      role={label ? "region" : undefined}
      aria-label={label}
      aria-live="off"
      onMouseEnter={() => onHold?.(true)}
      onMouseLeave={() => onHold?.(false)}
      onFocus={() => onHold?.(true)}
      onBlur={() => onHold?.(false)}
      className="sticky top-0 z-50 flex w-full items-center justify-center overflow-hidden px-11 text-center"
      style={{
        height,
        background: rainbow ? "var(--vg-canvas)" : "var(--vg-surface-overlay)",
        borderBlockEnd: "1px solid var(--vg-border-subtle)",
      }}
    >
      {rainbow && <Flow colors={rainbowColors} rtl={lang === "fa"} />}

      {/* A button, not a div with a handler: this navigates, and the keyboard
          has to be able to reach it. */}
      <button type="button" onClick={onClick} className="min-w-0 truncate text-[12.5px] font-bold" style={{ color: "var(--vg-text)" }}>
        {children}
      </button>

      <button
        type="button"
        aria-label={t("banner_close")}
        onClick={() => {
          setOpen(false);
          writeStoredValue(storageKey(id), true);
        }}
        className="vg-tap absolute end-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg transition-colors"
        style={{ color: "var(--vg-text-muted)" }}
      >
        <X size={14} weight="bold" />
      </button>
    </div>
  );
}

/** The reference's moving gradient, masked so it fades rather than ends. */
function Flow({ colors, rtl }: { colors?: string[] | undefined; rtl: boolean }) {
  const palette = colors?.length ? colors : DEFAULT_RAINBOW;
  const stops = [...palette, palette[0]].map((color, index) => `${color} ${(index * 50) / palette.length}%`).join(", ");

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[-1]"
        style={{
          maskImage: MASK,
          maskComposite: "intersect",
          animation: "vg-banner-flow 20s linear infinite",
          backgroundImage: `repeating-linear-gradient(${rtl ? 110 : 70}deg, ${stops})`,
          backgroundSize: "200% 100%",
          filter: "saturate(2)",
        }}
      />
      <style>{`@keyframes vg-banner-flow { from { background-position: 0% 0; } to { background-position: 100% 0; } }`}</style>
    </>
  );
}

/**
 * Shaped for a strip, not for a hero.
 *
 * The reference masks with `circle at top center`, whose default size is the
 * farthest corner — on a 1100x44 box that is a circle wider than the banner is
 * tall, so almost all of the colour fell outside the element and what remained
 * read as a flat dark bar rather than as a deliberate sheen. An explicit ellipse
 * anchored at the top edge spreads the same gradient along the strip instead of
 * across a square that is not there.
 */
const MASK = "linear-gradient(to bottom, white, rgb(255 255 255 / 0.35)), radial-gradient(140% 240% at 50% 0%, white, transparent 72%)";

/**
 * The brand's own two, not the reference's four-colour rainbow.
 *
 * Lime is "press this" here and blue is "know this" — a strip cycling red,
 * magenta and mint would introduce three signals the rest of the product does
 * not use. See DESIGN.md on orange being scarce; the same argument applies to
 * whatever replaced it.
 */
const DEFAULT_RAINBOW = [
  "rgb(from var(--vg-primary) r g b / 0.55)",
  "transparent",
  "rgb(from var(--vg-accent) r g b / 0.45)",
  "transparent",
];
