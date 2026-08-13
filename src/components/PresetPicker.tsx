import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, MagnifyingGlass } from "@phosphor-icons/react";
import { PRESETS, CATEGORY_LABEL, type Preset, type PresetCategory } from "../data/presets";
import { published } from "../data/content";
import { getFamily, type ModelKind } from "../data/models";
import { useModalSurface } from "./FloatingSurface";

/* ---------------------------------------------------------------------------
   The preset picker — what "تغییر" on the cover card should have opened.

   Both buttons on the create panel opened the same dropdown, which is the bug
   the owner called out. They are not the same decision:

     Model row    →  which engine runs this        →  a list with hard numbers
     Cover change →  which look am I going for     →  pictures

   The reference makes the same split: its cover card says GENERAL over the
   model name, and changing it opens the preset browser — "250+ presets for
   camera control, framing and VFX" — while the Model row underneath opens a
   list. A preset is chosen by eye; rendering it as text throws away the only
   thing that makes it choosable by someone who cannot write a prompt.

   Modal rather than popover: this is a gallery, and a 380px popover cannot show
   a grid worth looking at.
   --------------------------------------------------------------------------- */

const art = (seed: string) => `https://picsum.photos/seed/${seed}/360/480`;

export function PresetPicker({
  kind,
  selectedId,
  onPick,
  onClear,
  onClose,
}: {
  /** Only presets that run on this modality's models. */
  kind: ModelKind;
  selectedId: string | null;
  onPick: (p: Preset) => void;
  /** Back to the plain model with no preset prompt in front of it. */
  onClear: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<PresetCategory | "all">("all");
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useModalSurface({ surfaceRef: dialogRef, onClose, initialFocusRef: searchRef });

  const all = useMemo(() => published(PRESETS).filter((p) => (kind === "video" ? p.kind === "video" : p.kind === "image")), [kind]);
  const cats = useMemo(() => Array.from(new Set(all.map((p) => p.category))), [all]);
  const shown = all.filter((p) => (cat === "all" || p.category === cat) && (!q || p.title.includes(q.trim())));

  const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const cards = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-preset-option]") ?? []);
    if (!cards.length) return;
    const current = cards.indexOf(document.activeElement as HTMLButtonElement);
    const rtl = document.documentElement.dir === "rtl";
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : Math.min(cards.length - 1, current + 4);
    if (event.key === "ArrowUp") next = current < 0 ? 0 : Math.max(0, current - 4);
    if (event.key === "ArrowRight") next = current < 0 ? 0 : (current + (rtl ? -1 : 1) + cards.length) % cards.length;
    if (event.key === "ArrowLeft") next = current < 0 ? 0 : (current + (rtl ? 1 : -1) + cards.length) % cards.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = cards.length - 1;
    event.preventDefault();
    cards[next]?.focus();
  };

  return createPortal(
    <div
      data-modal-root
      className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center"
      style={{ background: "rgba(9,9,9,0.9)" }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-picker-title"
        tabIndex={-1}
        onKeyDown={moveFocus}
        className="flex max-h-[88dvh] w-full max-w-[860px] flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 p-4" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
          <div className="min-w-0 flex-1">
            <h2
              id="preset-picker-title"
              className="text-[17px] font-extrabold"
              style={{ fontFamily: "var(--vg-font-display)", color: "var(--vg-text)" }}
            >
              انتخاب افکت
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
              هر افکت یک پرامپت کامل است. انتخابش کن و فقط سوژه‌ات را اضافه کن.
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="بستن"
            className="grid size-9 shrink-0 place-items-center rounded-lg"
            style={{ color: "var(--vg-text-muted)" }}
          >
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 px-4 py-3">
          <div
            className="flex h-9 min-w-[160px] flex-1 items-center gap-2 rounded-lg px-2.5"
            style={{ background: "var(--vg-canvas)", border: "1px solid var(--vg-border-subtle)" }}
          >
            <MagnifyingGlass size={13} style={{ color: "var(--vg-text-faint)" }} />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="جستجوی افکت"
              className="w-full bg-transparent text-[12.5px] outline-none"
              style={{ color: "var(--vg-text)" }}
            />
          </div>
          {(["all", ...cats] as (PresetCategory | "all")[]).map((c) => (
            <button
              key={c}
              aria-pressed={cat === c}
              onClick={() => setCat(c)}
              className="h-9 shrink-0 rounded-lg px-3 text-[12px] font-semibold transition-colors"
              style={{
                background: cat === c ? "var(--vg-primary-a14)" : "var(--vg-canvas)",
                color: cat === c ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                border: "1px solid var(--vg-border-subtle)",
              }}
            >
              {c === "all" ? "همه" : CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>

        <div className="hide-scrollbar grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 pt-1 sm:grid-cols-3 lg:grid-cols-4">
          {/* "No preset" is a real choice and gets a real cell — otherwise the
              only way back to a plain prompt is to reload the page. */}
          <button
            data-preset-option
            aria-pressed={selectedId == null}
            onClick={() => {
              onClear();
              onClose();
            }}
            className="grid aspect-[3/4] place-items-center rounded-xl text-[12.5px] font-semibold"
            style={{
              background: "var(--vg-canvas)",
              border: `1px dashed ${selectedId == null ? "var(--vg-primary)" : "var(--vg-border)"}`,
              color: selectedId == null ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
            }}
          >
            بدون افکت
          </button>

          {shown.map((p) => {
            const on = p.id === selectedId;
            return (
              <button
                key={p.id}
                data-preset-option
                aria-pressed={on}
                onClick={() => {
                  onPick(p);
                  onClose();
                }}
                className="group relative block aspect-[3/4] overflow-hidden rounded-xl text-start"
                style={on ? { outline: "2px solid var(--vg-primary)", outlineOffset: "-2px" } : undefined}
              >
                <img
                  src={art(p.seed)}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                />
                <span className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent 55%)" }} />
                <span className="absolute inset-x-2.5 bottom-2 block">
                  <span className="block text-[13px] font-extrabold leading-tight" style={{ color: "var(--vg-text)" }}>
                    {p.title}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px]" style={{ color: "var(--vg-text-secondary)" }}>
                    {getFamily(p.familyId)?.name}
                  </span>
                </span>
              </button>
            );
          })}

          {shown.length === 0 && (
            <p className="col-span-full py-10 text-center text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
              افکتی با این نام نیست.
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
