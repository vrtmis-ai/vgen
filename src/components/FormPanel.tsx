import { useEffect, useMemo, useState } from "react";
import { CaretLeft, Image as ImageIcon, MusicNote, VideoCamera, Sparkle, PencilSimple } from "@phosphor-icons/react";
import {
  defaultInput,
  variantControls,
  type Control,
  type Family,
  type Variant,
} from "../data/models";
import type { InputMap } from "./controls";
import { priceCoins } from "../data/pricing";
import { useI18n } from "../lib/i18n";
import { CoinMark } from "./chrome";
import { useImageFallback } from "../lib/useImageFallback";

/* ---------------------------------------------------------------------------
   The create panel — 320px on the inline start, measured off Higgsfield's own
   /ai/video screen rather than its marketing page.

   The marketing hero shows a compact horizontal prompt bar; the real app does
   not. It runs a fixed 320px panel (their `--form-panel-width: 20rem`) holding
   a vertical stack of self-contained cards, with the canvas taking the rest.
   Two details of that stack carry most of its character:

   · There are almost no bordered inputs. Each group is a rounded card on a
     lifted surface, and the label sits inside the card in 11px muted type. An
     input outline would add a second edge to something that already has one.

   · The primary button carries the price. Higgsfield prints the credit cost on
     Generate — struck-through at list, discounted beside it. VGen bills per
     generation rather than by subscription, so this is not a departure from the
     reference; it is the part of the reference that matters most to us.

   In RTL the panel sits on the right. That is not a flip for its own sake: the
   panel is first in the reference's reading order, and first in Persian reading
   order is the right edge. Every offset here is logical, so it mirrors with no
   direction-specific rule.
   --------------------------------------------------------------------------- */

type ChipControl = Extract<Control, { kind: "aspect" | "segment" | "toggle" | "slider" }>;

function chipControls(controls: Control[]): ChipControl[] {
  return controls.filter(
    (c): c is ChipControl =>
      !("advanced" in c && c.advanced) &&
      (c.kind === "aspect" || c.kind === "segment" || c.kind === "toggle" || c.kind === "slider"),
  );
}

function valueLabel(c: ChipControl, input: InputMap): string {
  const v = input[c.key];
  if (c.kind === "toggle") return v ? "روشن" : "خاموش";
  if (c.kind === "slider") return `${v}${c.unit ? ` ${c.unit}` : ""}`;
  return c.options.find((o) => o.value === String(v))?.label ?? String(v ?? c.def);
}

function sliderSteps(c: Extract<Control, { kind: "slider" }>): number[] {
  const out: number[] = [];
  for (let v = c.min; v <= c.max + 1e-9; v += c.step) out.push(Number(v.toFixed(4)));
  return out.length > 8 ? out.filter((_, i) => i % Math.ceil(out.length / 8) === 0) : out;
}

/** The panel's one surface primitive. Everything in the stack is one of these. */
function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-xl ${className}`}
      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)" }}
    >
      {children}
    </div>
  );
}

/** A full-width row that opens something: label on the start, value + caret on
 *  the end. Used for model and for any control with too many options to chip. */
function RowSelect({
  label,
  value,
  accent,
  onClick,
}: {
  label: string;
  value: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2.5 text-start">
      <span className="flex-1 truncate text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        {label}
      </span>
      <span
        className="truncate text-[12.5px] font-semibold"
        style={{ color: accent ? "var(--vg-primary-soft)" : "var(--vg-text)" }}
      >
        {value}
      </span>
      {/* CaretLeft, not Right: in RTL "forward" points to the left. */}
      <CaretLeft size={13} weight="bold" style={{ color: "var(--vg-text-faint)" }} />
    </button>
  );
}

function PresetCard({ family, onChange }: { family: Family; onChange: () => void }) {
  const [failed, onError] = useImageFallback();
  return (
    <div
      className="relative aspect-[16/10] overflow-hidden rounded-xl"
      style={{ background: family.grad, border: "1px solid var(--vg-border-subtle)" }}
    >
      {family.cover && !failed && (
        <img src={family.cover} alt="" onError={onError} className="absolute inset-0 size-full object-cover" />
      )}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78), transparent 62%)" }} />
      <button
        onClick={onChange}
        className="absolute top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold backdrop-blur-md"
        style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
      >
        <PencilSimple size={11} weight="bold" />
        تغییر
      </button>
      <div className="absolute bottom-2.5 px-3" style={{ insetInlineStart: 0 }}>
        <p className="text-[15px] font-extrabold leading-tight" style={{ color: "var(--vg-primary-soft)" }}>
          {family.name}
        </p>
        <p className="text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          {family.vendor}
        </p>
      </div>
    </div>
  );
}

export function FormPanel({
  families,
  family,
  onFamily,
  onGenerate,
}: {
  families: Family[];
  family: Family;
  onFamily: (f: Family) => void;
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
}) {
  const { n } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [pickModel, setPickModel] = useState(false);

  const variant = family.variants[0]!;
  const controls = useMemo(() => variantControls(family, variant), [family, variant]);
  const [input, setInput] = useState<InputMap>(() => defaultInput(controls));

  // A different family means a different control set; the old keys may not even
  // exist on the new model, which the provider answers with a 422.
  useEffect(() => setInput(defaultInput(controls)), [controls]);

  const chips = chipControls(controls);
  const price = priceCoins(variant, input, { chars: prompt.length, clipSeconds: 0 });
  const ready = (family.noPrompt || prompt.trim().length > 0) && price !== null;
  const set = (k: string, v: string | number | boolean) => setInput((p) => ({ ...p, [k]: v }));

  return (
    // The height cap is `md:` only. Applied at every width it clips the panel on
    // a phone, where the panel is a stacked block rather than a column beside
    // the canvas and has the whole page to grow into.
    <aside className="flex w-full shrink-0 flex-col gap-2 md:sticky md:top-11 md:max-h-[calc(100dvh-2.75rem)] md:w-[var(--vg-form-panel)] md:self-start md:overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        <PresetCard family={family} onChange={() => setPickModel((v) => !v)} />

        {pickModel && (
          <Card className="max-h-56 overflow-y-auto p-1">
            {families.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  onFamily(f);
                  setPickModel(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-white/5"
              >
                <span className="flex-1 truncate text-[13px]" style={{ color: f.id === family.id ? "var(--vg-primary-soft)" : "var(--vg-text)" }}>
                  {f.name}
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                  {f.vendor}
                </span>
              </button>
            ))}
          </Card>
        )}

        {/* Upload sits above the prompt, as its own card. A reference file is a
            first-class input on most of this catalog, not an afterthought. */}
        <Card className="px-3 py-4 text-center">
          <div className="mb-2 flex justify-center gap-1.5">
            {[ImageIcon, VideoCamera, MusicNote].map((Icon, i) => (
              <span
                key={i}
                className="grid size-7 place-items-center rounded-lg"
                style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
              >
                <Icon size={14} />
              </span>
            ))}
          </div>
          <p className="text-[12.5px]" style={{ color: "var(--vg-text)" }}>
            افزودن فایل
          </p>
          <p className="text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            تصویر، ویدیو یا صدا
          </p>
        </Card>

        <Card className="p-3">
          <p className="mb-1 text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
            پرامپت
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            disabled={family.noPrompt}
            placeholder={family.noPrompt ? "این مدل پرامپت نمی‌گیرد — فقط فایل بده" : "صحنه‌ات را با جزئیات توصیف کن."}
            className="hide-scrollbar w-full resize-none bg-transparent text-[13px] leading-6 outline-none disabled:opacity-40"
            style={{ color: "var(--vg-text)" }}
          />
          {/* Toggles live inside the prompt card, as small pills on its floor. */}
          <div className="mt-1 flex flex-wrap gap-1.5">
            {chips
              .filter((c) => c.kind === "toggle")
              .map((c) => (
                <button
                  key={c.key}
                  onClick={() => set(c.key, !input[c.key])}
                  className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] font-medium"
                  style={{
                    background: input[c.key] ? "rgba(233,95,24,0.14)" : "var(--vg-surface-overlay)",
                    color: input[c.key] ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                  }}
                >
                  {c.label}: {valueLabel(c, input)}
                </button>
              ))}
          </div>
        </Card>

        <Card>
          <RowSelect label="مدل" value={family.name} onClick={() => setPickModel((v) => !v)} />
        </Card>

        {/* Segments and aspects sit in a chip grid — three across, the widths
            equal so the row reads as one control strip rather than a form. */}
        {chips.some((c) => c.kind !== "toggle") && (
          <div className="grid grid-cols-3 gap-1.5">
            {chips
              .filter((c) => c.kind !== "toggle")
              .map((c) => {
                const opts =
                  c.kind === "slider"
                    ? sliderSteps(c).map((v) => ({ value: c.asString ? String(v) : v, label: `${v}${c.unit ? ` ${c.unit}` : ""}` }))
                    : c.options.map((o) => ({ value: o.value as string | number, label: o.label }));
                return (
                  <label key={c.key} className="relative block">
                    <span className="sr-only">{c.label}</span>
                    <select
                      value={String(input[c.key])}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const match = opts.find((o) => String(o.value) === raw);
                        set(c.key, match ? match.value : raw);
                      }}
                      className="h-9 w-full cursor-pointer appearance-none rounded-lg px-2 text-center text-[12px] font-semibold outline-none"
                      style={{ background: "var(--vg-surface)", border: "1px solid var(--vg-border-subtle)", color: "var(--vg-text)" }}
                    >
                      {opts.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
          </div>
        )}
      </div>

      {/* The button is pinned to the panel floor, not scrolled with the stack.
          It is the only thing on this surface the user is guaranteed to want. */}
      <div
        className="sticky bottom-0 mt-auto p-3"
        style={{ background: "var(--vg-canvas)", borderBlockStart: "1px solid var(--vg-border-subtle)" }}
      >
        <button
          disabled={!ready}
          onClick={() => onGenerate(family, variant, prompt.trim(), input)}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition-opacity disabled:opacity-35"
          style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
        >
          <Sparkle size={15} weight="fill" />
          بساز
          <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
            <CoinMark size={12} />
            <span className="vg-numeric">{price === null ? "—" : n(price)}</span>
          </span>
        </button>
        {price === null && (
          <p className="mt-1.5 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            این ترکیب قیمت‌گذاری نمی‌شود، پس فروخته نمی‌شود.
          </p>
        )}
      </div>
    </aside>
  );
}
