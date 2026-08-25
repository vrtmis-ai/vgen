"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CaretDown } from "@phosphor-icons/react";
import { ModelMark } from "./ModelMark";
import { useI18n } from "../lib/i18n";
import { EASE_OUT } from "../lib/motion";
import type { NavMenu } from "./navMenu";

/* ---------------------------------------------------------------------------
   The panel that opens under a nav item.

   Modelled on the reference's Image menu, which is a row of titled columns of
   mark + name + one line of description. The borrowing that matters is that the
   menu names *models*, not sections: a visitor deciding where to spend has
   heard of Veo and Kling, and a menu reading "generate / edit / library" tells
   them nothing they can act on.

   Three departures from the pasted reference, each forced by this codebase:

   - **It is not hover-only.** The reference opens on `onMouseEnter` and has no
     other way in, which puts every model behind a pointer. Here hover opens it,
     click toggles it and Escape closes it — the e2e tests reach the nav by role
     and a keyboard user has to get to the same places, which they do through
     Enter and Space firing the same click.

     Focus deliberately does *not* open it. An earlier pass had `onFocus` open
     the panel, and it made the plain click impossible: `userEvent.click`, and a
     real pointer press, focus the button before the click event lands, so the
     focus handler opened it and the toggle immediately shut it again. Nobody
     without a mouse hover could get in at all. Opening on tab-through is also
     the wrong behaviour on its own terms — a keyboard user passing the bar gets
     a panel they did not ask for over the page they are reading.

   - **Logical properties throughout.** `left-0` in the reference would pin the
     panel to the visual left, which in RTL is the wrong end of its trigger.

   - **Tokens, not `#0A0A0A` and `white/10`.** Same surfaces the sheets use, so
     the panel sits at the established overlay step rather than inventing a
     fourth near-black.
   --------------------------------------------------------------------------- */

/**
 * Which bar the trigger is sitting in.
 *
 * Two bars show these menus and they do not look alike: the app's is a 44px row
 * of pills, the landing page's is a floating glass header of plain text links.
 * The panel below is identical in both — only the thing you press differs — so
 * the difference is named here rather than passed in as class strings from two
 * call sites that would drift apart.
 */
export type MegaMenuVariant = "bar" | "plain";

export function MegaMenu({
  label,
  badge,
  menu,
  active,
  variant = "bar",
  onOpenModel,
  onNav,
}: {
  label: string;
  badge?: string | undefined;
  menu: NavMenu;
  active: boolean;
  variant?: MegaMenuVariant;
  onOpenModel: (familyId: string) => void;
  /** The footer link — the studio the menu describes. */
  onNav: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrap = useRef<HTMLLIElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  const reduced = useReducedMotion();

  const close = useCallback(() => setOpen(false), []);

  /**
   * Nudge the panel back inside the viewport.
   *
   * It hangs from `inset-inline-start: 0` of its own item, so its width grows
   * away from the trigger — and under RTL that is leftward. On the landing page
   * ویدیو sits near the right edge with a three-column panel behind it, so the
   * last column ran off the screen with no way to scroll to it: the row has a
   * horizontal scroller inside, but nothing can scroll a box whose overflow is
   * off the document.
   *
   * Measured rather than guessed, because the answer depends on where the item
   * landed and how many columns the *catalogue* gave it — neither is known at
   * write time. `useEffect` rather than `useLayoutEffect`: this is a client
   * component Next still renders on the server, where the layout variant warns,
   * and the correction lands within a frame while the panel is still fading up
   * from nothing.
   */
  useEffect(() => {
    if (!open) {
      setShift(0);
      return;
    }

    const fit = () => {
      const node = panel.current;
      if (!node) return;
      // Undo any correction before measuring, or the second pass measures the
      // result of the first and walks the panel across the screen.
      node.style.transform = "";
      const box = node.getBoundingClientRect();
      const margin = 12;
      const overStart = margin - box.left;
      const overEnd = box.right - (document.documentElement.clientWidth - margin);
      setShift(overStart > 0 ? overStart : overEnd > 0 ? -overEnd : 0);
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [open, menu]);

  // Escape closes from anywhere inside, and focus leaving the item closes too.
  // Without the second one a keyboard user tabs out of the last model and the
  // panel stays open over the page they just moved to.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  return (
    <li
      ref={wrap}
      className="relative shrink-0"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
      onBlur={(event) => {
        if (!wrap.current?.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      {/* Two controls, not one, and this is the WAI disclosure-navigation
          pattern rather than a flourish. The label is the destination — تصویر
          *is* the image studio, and the reference ships its top-level items as
          plain links for exactly that reason. The caret is what opens the panel.

          One button doing both cannot work: hover opens the panel, so the click
          that followed would toggle it shut, and a pointer user pressing the
          item would see it flicker instead of going anywhere. Splitting them
          gives the mouse user a destination, the hover user the panel, and the
          keyboard user a named control that opens it without a pointer. */}
      <span
        className={
          variant === "bar"
            ? "flex shrink-0 items-center gap-0.5 rounded-lg ps-1.5 pe-1 transition-colors"
            : "flex shrink-0 items-center gap-0.5 transition-colors"
        }
        style={variant === "bar" ? { background: active ? "var(--vg-primary-a14)" : "transparent" } : undefined}
      >
        <button
          type="button"
          onClick={() => {
            close();
            onNav();
          }}
          aria-current={active ? "page" : undefined}
          className={
            variant === "bar"
              ? "flex items-center gap-1 whitespace-nowrap py-1 text-[13px] transition-colors"
              : "flex items-center gap-1 whitespace-nowrap text-sm transition-colors hover:text-[color:var(--vg-text)]"
          }
          style={{
            color:
              variant === "bar"
                ? active
                  ? "var(--vg-primary-soft)"
                  : "var(--vg-text-muted)"
                : active || open
                  ? "var(--vg-text)"
                  : "var(--vg-text-muted)",
          }}
        >
          {label}
          {badge && (
            <span
              className="rounded px-1 py-px text-[9.5px] font-bold"
              style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
            >
              {badge}
            </span>
          )}
        </button>

        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          /* Named, because "⌄" is not a name. The e2e tests select by role and
             a screen reader announces this one on its own. */
          aria-label={t("menu_toggle").replace("{x}", label)}
          onClick={() => setOpen((was) => !was)}
          className="flex items-center rounded p-1 transition-colors"
          style={{ color: active ? "var(--vg-primary-soft)" : "var(--vg-text-muted)" }}
        >
          <CaretDown
            size={11}
            weight="bold"
            aria-hidden
            className="transition-transform"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          />
        </button>
      </span>

      <AnimatePresence>
        {open && (
          <div
            ref={panel}
            className="absolute top-full z-50 pt-2"
            style={{ insetInlineStart: 0, transform: shift ? `translateX(${shift}px)` : undefined }}
          >
            <motion.div
              id={panelId}
              initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              className="w-max max-w-[min(92vw,var(--vg-container-max))] p-4"
              style={{
                background: "var(--vg-surface-overlay)",
                border: "1px solid var(--vg-border-subtle)",
                borderRadius: "var(--vg-radius-lg)",
                boxShadow: "var(--vg-shadow-modal)",
              }}
            >
              <div className="flex gap-8 overflow-x-auto hide-scrollbar">
                {menu.columns.map((column) => (
                  <div key={column.code} className="min-w-0">
                    <h3 className="mb-3 text-[11px] font-medium" style={{ color: "var(--vg-text-faint)" }}>
                      {t(column.title)}
                    </h3>
                    <ul className="space-y-3">
                      {column.rows.map(({ family }) => (
                        <li key={family.id}>
                          <button
                            type="button"
                            onClick={() => {
                              close();
                              onOpenModel(family.id);
                            }}
                            className="group flex w-full items-start gap-2.5 text-start"
                          >
                            {/* The bordered square is the reference's, and it is
                                doing work: nineteen marks at nineteen intrinsic
                                weights read as a ragged column without one
                                shape holding them to a grid. */}
                            <span
                              className="grid size-8 shrink-0 place-items-center transition-colors"
                              style={{
                                border: "1px solid var(--vg-border)",
                                borderRadius: "var(--vg-radius-sm)",
                                color: "var(--vg-text-secondary)",
                              }}
                            >
                              <ModelMark familyId={family.id} vendor={family.vendor} size={16} />
                            </span>
                            <span className="min-w-0 leading-5">
                              <span className="flex items-center gap-1.5">
                                <span className="text-[13px] font-semibold" style={{ color: "var(--vg-text)" }}>
                                  {family.name}
                                </span>
                                {family.badge && (
                                  <span
                                    className="shrink-0 rounded px-1 py-px text-[9px] font-bold"
                                    style={{ background: "var(--vg-primary-a20)", color: "var(--vg-primary-soft)" }}
                                  >
                                    {family.badge}
                                  </span>
                                )}
                              </span>
                              {/* The catalogue's own blurb. A second sentence
                                  written here would be a copy of a served one
                                  that could drift from it. */}
                              <span
                                className="mt-0.5 block max-w-[230px] text-[11.5px] transition-colors group-hover:text-[color:var(--vg-text-secondary)]"
                                style={{ color: "var(--vg-text-muted)" }}
                              >
                                {family.blurb}
                              </span>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* The surface itself. Without it the menu can describe ویدیو
                  without offering the studio it belongs to, and the top-level
                  item has been turned into a thing that only opens a panel. */}
              <button
                type="button"
                onClick={() => {
                  close();
                  onNav();
                }}
                className="mt-4 flex w-full items-center justify-center rounded-lg py-2 text-[12px] font-semibold transition-colors"
                style={{
                  background: "var(--vg-primary-a10)",
                  color: "var(--vg-primary-soft)",
                  border: "1px solid var(--vg-border-primary)",
                }}
              >
                {t(menu.footer.label)}
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </li>
  );
}
