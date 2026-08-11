import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Lock, MagnifyingGlass } from "@phosphor-icons/react";
import { type Family, type Variant } from "../data/models";
import { variantMeta } from "../lib/useCreateState";
import { priceCoins } from "../data/pricing";
import { useAccess } from "../lib/access";
import { VendorMark } from "./VendorMark";
import { CoinMark } from "./chrome";
import { useI18n } from "../lib/i18n";

/* ---------------------------------------------------------------------------
   The model picker.

   Every surface here was opening the same 180px list of "name · vendor" — the
   same menu used for aspect ratio and duration. Choosing a model is not the
   same kind of decision as choosing 16:9, and a menu that treats it as one
   forces the user out to the catalog page to find out what anything is.

   Measured off the reference's picker: a 400px panel at radius 16 on
   rgba(28,30,32,.95) under a 32px backdrop blur, rows 52px at radius 12, and —
   the part that matters — each row carrying the two facts that decide the
   choice: top resolution and the length range. Both are already in our catalog.

   Two groups, as theirs has: the variants of the family in hand, then every
   other family with its one-line blurb. That ordering answers the two questions
   in the order people ask them — "which version of this?" then "or something
   else?".
   --------------------------------------------------------------------------- */

/** A 10px grey pill. The reference's unit of row metadata. */
function Meta({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="vg-numeric shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
      style={{ background: "rgba(255,255,255,0.05)", color: "var(--vg-text-muted)" }}
    >
      {children}
    </span>
  );
}

function Row({
  family,
  variant,
  selected,
  locked,
  onPick,
}: {
  family: Family;
  variant?: Variant | undefined;
  selected: boolean;
  /**
   * Above the account's plan tier.
   *
   * The row stays in the list and stays clickable — it routes to plans instead
   * of loading the model. Hiding locked models would make the ladder invisible
   * exactly to the people it is meant to sell to, and it is the same rule the
   * asset viewer already follows for tools we have no model for: visible, with
   * the reason on it.
   */
  locked: boolean;
  onPick: () => void;
}) {
  const { n } = useI18n();
  const v = variant ?? family.variants[0]!;
  const meta = useMemo(() => variantMeta(family, v), [family, v]);
  // Quoted at the variant's own defaults, which is what the panel will load.
  const coins = useMemo(() => priceCoins(v, {}, { chars: 0, clipSeconds: 0 }), [v]);
  const access = useAccess();
  const need = useMemo(() => (locked ? access.needs(family.id) : null), [locked, access, family.id]);

  return (
    <button
      onClick={onPick}
      className="flex h-[52px] w-full items-center gap-2.5 rounded-xl px-2.5 text-start transition-colors hover:bg-white/[0.06]"
      style={selected ? { background: "var(--vg-primary-a14)" } : undefined}
    >
      <span className="relative shrink-0" style={{ opacity: locked ? 0.45 : 1 }}>
        <VendorMark vendor={family.vendor} size={22} />
      </span>

      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-center gap-1.5">
          <bdi
            className="truncate text-[12.5px] font-medium"
            style={{ color: locked ? "var(--vg-text-muted)" : selected ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
          >
            {variant ? `${family.name} ${v.label}` : family.name}
          </bdi>
          {v.badge && (
            <span
              className="shrink-0 rounded px-1 py-px text-[9.5px] font-bold"
              style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
            >
              {v.badge}
            </span>
          )}
        </span>

        {/* Blurb for a family row, hard numbers for a variant row. */}
        {variant ? (
          <span className="flex items-center gap-1">
            {meta.topRes && <Meta>{meta.topRes}</Meta>}
            {meta.range && <Meta>{meta.range}</Meta>}
          </span>
        ) : (
          <span className="truncate text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
            {family.blurb}
          </span>
        )}
      </span>

      {/* The plan that unlocks it replaces the price. A coin figure on a model
          you cannot run is answering a question the user has not reached yet;
          the name of the plan is the only useful thing to say here. */}
      {locked ? (
        need && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-bold"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-secondary)" }}
          >
            <Lock size={10} weight="fill" />
            <bdi>{need.name}</bdi>
          </span>
        )
      ) : (
        coins != null && (
          <span className="flex shrink-0 items-center gap-1 text-[11.5px]" style={{ color: "var(--vg-text-muted)" }}>
            <CoinMark size={11} />
            <span className="vg-numeric">{n(coins)}</span>
          </span>
        )
      )}
      {selected && !locked && <Check size={13} weight="bold" style={{ color: "var(--vg-primary-soft)" }} />}
    </button>
  );
}

/**
 * Trigger plus picker, for the docks.
 *
 * One chip, not two. The docks used to carry a family chip and a variant chip
 * side by side, which asked the user to understand our data model before they
 * could pick a model. The picker shows variants and families in one panel, so
 * the chip can just say what is selected.
 */
export function ModelChip({
  families,
  family,
  variant,
  onPickFamily,
  onPickVariant,
  className,
  style,
}: {
  families: Family[];
  family: Family;
  variant: Variant;
  onPickFamily: (f: Family) => void;
  onPickVariant: (id: string) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((v) => !v)} aria-haspopup="dialog" aria-expanded={open} className={className} style={style}>
        <VendorMark vendor={family.vendor} size={15} />
        <bdi>{family.variants.length > 1 ? `${family.name} ${variant.label}` : family.name}</bdi>
      </button>
      {open && (
        <ModelPicker
          anchor={ref.current}
          families={families}
          family={family}
          variant={variant}
          onPickFamily={onPickFamily}
          onPickVariant={onPickVariant}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ModelPicker({
  anchor,
  families,
  family,
  variant,
  onPickFamily,
  onPickVariant,
  onClose,
}: {
  anchor: HTMLElement | null;
  families: Family[];
  family: Family;
  variant: Variant;
  onPickFamily: (f: Family) => void;
  onPickVariant: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [q, setQ] = useState("");
  const access = useAccess();

  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const a = anchor.getBoundingClientRect();
    const m = ref.current.getBoundingClientRect();
    // Prefer above — these hang off docks pinned to the bottom — then below,
    // then clamp so a 640px panel never runs off a short viewport.
    let top = a.top - m.height - 8;
    if (top < 8) top = Math.min(a.bottom + 8, Math.max(8, window.innerHeight - m.height - 8));
    const rtl = document.documentElement.dir === "rtl";
    let left = rtl ? a.right - m.width : a.left;
    left = Math.max(8, Math.min(left, window.innerWidth - m.width - 8));
    setPos({ top, left });
  }, [anchor, q]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [anchor, onClose]);

  const match = (s: string) => s.toLowerCase().includes(q.trim().toLowerCase());
  const variants = family.variants.filter((v) => !q || match(`${family.name} ${v.label}`));
  const others = families.filter((f) => f.id !== family.id && (!q || match(f.name) || match(f.blurb)));

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      className="fixed z-[80] flex max-h-[min(640px,80dvh)] w-[380px] flex-col overflow-hidden rounded-2xl"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        background: "rgba(28,30,32,0.95)",
        backdropFilter: "blur(32px)",
        border: "1px solid var(--vg-border-subtle)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.65)",
        visibility: pos ? "visible" : "hidden",
      }}
    >
      <div className="flex items-center gap-2 px-3 py-2.5" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
        <MagnifyingGlass size={14} style={{ color: "var(--vg-text-faint)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجوی مدل"
          autoFocus
          className="w-full bg-transparent text-[13px] outline-none"
          style={{ color: "var(--vg-text)" }}
        />
      </div>

      <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
        {variants.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold" style={{ color: "var(--vg-text-faint)" }}>
              نسخه‌های {family.name}
            </p>
            {variants.map((v) => (
              <Row
                key={v.id}
                family={family}
                variant={v}
                selected={v.id === variant.id}
                locked={!access.can(family.id)}
                onPick={() => {
                  onClose();
                  if (!access.can(family.id)) return access.onUpgrade();
                  onPickVariant(v.id);
                }}
              />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            <p className="px-2 pb-1 pt-3 text-[11px] font-semibold" style={{ color: "var(--vg-text-faint)" }}>
              همهٔ مدل‌ها
            </p>
            {others.map((f) => (
              <Row
                key={f.id}
                family={f}
                selected={false}
                locked={!access.can(f.id)}
                onPick={() => {
                  onClose();
                  if (!access.can(f.id)) return access.onUpgrade();
                  onPickFamily(f);
                }}
              />
            ))}
          </>
        )}

        {variants.length === 0 && others.length === 0 && (
          <p className="px-2 py-6 text-center text-[12.5px]" style={{ color: "var(--vg-text-muted)" }}>
            مدلی با این نام نیست.
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
