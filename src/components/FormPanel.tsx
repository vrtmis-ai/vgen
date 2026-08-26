import { useEffect, useRef, useState } from "react";
import { useSession } from "../runtime/providers/SessionProvider";
import { CaretLeft, Lock, Sparkle, PencilSimple } from "@phosphor-icons/react";
import { type Family, type Variant, variantRefs } from "../data/models";
import { isImageSlot, pairsImages, refGroups, slotsInGroup } from "../lib/refSlots";
import { RefUpload, type InputMap, type RefMap } from "./controls";
import { useCreateState, valueLabel, rangeOf } from "../lib/useCreateState";
import { ModelPicker } from "./ModelPicker";
import { PresetPicker } from "./PresetPicker";
import type { Preset } from "../runtime/contracts/content";
import { useI18n } from "../lib/i18n";
import { useAccess } from "../lib/access";
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

/* chipControls / valueLabel / sliderSteps live in lib/useCreateState — this file
   had its own copies, which is the usual way two surfaces drift apart. */

/**
 * The panel's one surface primitive. Everything in the stack is one of these.
 *
 * Measured off their panel: radius 12 on `rgba(255,255,255,0.05)` with no
 * border. It was an opaque `--vg-surface` behind a hairline here, which reads
 * heavier — a wash lifts off the panel without drawing a second edge around
 * something the panel background already separates.
 */
export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl ${className}`} style={{ background: "rgba(255,255,255,0.05)" }}>
      {children}
    </div>
  );
}

/** The 342px column both create panels sit in, on their `#131517`. */
export function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      className="flex w-full shrink-0 flex-col md:sticky md:top-11 md:max-h-[calc(100dvh-2.75rem)] md:w-[var(--vg-form-panel)] md:self-start md:overflow-y-auto"
      style={{ background: "var(--vg-deep)" }}
    >
      {children}
    </aside>
  );
}

/** Underline tabs, as their audio panel heads with. 2px on the active item. */
export function PanelTabs<T extends string>({
  tabs,
  active,
  onPick,
}: {
  tabs: { key: T; label: string; disabled?: boolean }[];
  active: T;
  onPick: (k: T) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-3" style={{ borderBlockEnd: "1px solid var(--vg-border-subtle)" }}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            onClick={() => !t.disabled && onPick(t.key)}
            disabled={t.disabled}
            aria-current={on ? "page" : undefined}
            title={t.disabled ? "به‌زودی" : undefined}
            className="h-9 whitespace-nowrap text-[12.5px] font-semibold transition-colors disabled:opacity-40"
            style={{
              color: on ? "var(--vg-text)" : "var(--vg-text-muted)",
              borderBlockEnd: `2px solid ${on ? "var(--vg-text)" : "transparent"}`,
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** A full-width row that opens something: label on the start, value + caret on
 *  the end. Used for model and for any control with too many options to chip. */
function RowSelect({ label, value, accent, onClick }: { label: string; value: string; accent?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-2.5 text-start">
      <span className="flex-1 truncate text-[12px]" style={{ color: "var(--vg-text-muted)" }}>
        {label}
      </span>
      <span className="truncate text-[12.5px] font-semibold" style={{ color: accent ? "var(--vg-primary-soft)" : "var(--vg-text)" }}>
        {value}
      </span>
      {/* CaretLeft, not Right: in RTL "forward" points to the left. */}
      <CaretLeft size={13} weight="bold" style={{ color: "var(--vg-text-faint)" }} />
    </button>
  );
}

/**
 * The cover card shows the PRESET, with the model as its subtitle — the
 * reference reads "GENERAL" over "Seedance 2.0", not the model twice.
 *
 * That split is the whole point of the card: the big word is the look you
 * picked, and "تغییر" changes the look. The model lives in its own row below
 * and has its own picker.
 */
function PresetCard({ family, preset, onChange }: { family: Family; preset: Preset | null; onChange: () => void }) {
  const [failed, onError] = useImageFallback();
  const cover = preset ? `https://picsum.photos/seed/${preset.seed}/480/300` : family.cover;
  return (
    <div
      className="relative aspect-[16/10] overflow-hidden rounded-xl"
      style={{ background: family.grad, border: "1px solid var(--vg-border-subtle)" }}
    >
      {cover && !failed && <img src={cover} alt="" onError={onError} className="absolute inset-0 size-full object-cover" />}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78), transparent 62%)" }} />
      <button
        onClick={onChange}
        aria-label="تغییر افکت"
        className="vg-tap absolute top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold backdrop-blur-md"
        style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
      >
        <PencilSimple size={11} weight="bold" />
        تغییر
      </button>
      <div className="absolute bottom-2.5 px-3" style={{ insetInlineStart: 0 }}>
        <p className="text-[15px] font-extrabold leading-tight" style={{ color: "var(--vg-primary-soft)" }}>
          {preset ? preset.title : "بدون افکت"}
        </p>
        <p className="text-[11px]" style={{ color: "var(--vg-text-secondary)" }}>
          <bdi>{family.name}</bdi>
        </p>
      </div>
    </div>
  );
}

export function FormPanel({
  families,
  onGenerate,
}: {
  families: Family[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap) => void;
}) {
  const { t, n } = useI18n();
  // A visitor sees the whole dock — models, controls, the price — and the one
  // button that would spend turns into the way to get an account.
  const { user, signIn } = useSession();
  const visitor = user === null;
  const [pickModel, setPickModel] = useState(false);
  const [pickPreset, setPickPreset] = useState(false);
  const [preset, setPreset] = useState<Preset | null>(null);
  const modelRow = useRef<HTMLDivElement>(null);

  // Same hook as the other two studios. This panel used to keep its own copy of
  // family/controls/input/price, which is how it ended up pinned to variants[0]
  // while the shared version moved on.
  const s = useCreateState(families);
  const { family, variant, chips, input, prompt, price, ready, validation, isSubmitting } = s;
  const access = useAccess();
  const locked = !access.can(family.id);
  const need = locked ? access.needs(family.id) : null;
  const set = s.set;
  const setPrompt = s.setPrompt;
  const onFamily = s.setFamily;

  /* The slots this model actually offers, and which group is on screen.
     `variantRefs` resolves the variant's own list against the family's, which is
     how "this variant has no slots" (`refs: null`) stays different from "inherit
     the family's". */
  const slots = variantRefs(family, variant);
  const groups = refGroups(slots);
  const [refTab, setRefTab] = useState<"reference" | "frame">("reference");
  const activeTab = groups.includes(refTab) ? refTab : (groups[0] ?? "reference");
  const shownSlots = slotsInGroup(slots, activeTab);
  const pairs = pairsImages(shownSlots);

  /* Files live here rather than in `useCreateState`, because they are object
     URLs with a lifetime: switching model has to revoke them or the tab leaks a
     blob per upload. */
  const [refImages, setRefImages] = useState<RefMap>({});
  useEffect(() => {
    return () => {
      for (const files of Object.values(refImages)) for (const file of files) URL.revokeObjectURL(file.url);
    };
    // Only on unmount — revoking on every change would kill the preview the
    // user is still looking at.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // The height cap is `md:` only. Applied at every width it clips the panel on
    // a phone, where the panel is a stacked block rather than a column beside
    // the canvas and has the whole page to grow into.
    <PanelShell>
      <div className="flex flex-col gap-2 p-3">
        <PresetCard family={family} preset={preset} onChange={() => setPickPreset(true)} />

        {pickPreset && (
          <PresetPicker
            kind={family.kind}
            selectedId={preset?.id ?? null}
            onPick={(p) => {
              setPreset(p);
              // A preset is a prompt with a hole in it, so it seeds the box and
              // switches to the family it was written against — running it on
              // another model is not the effect the picture showed.
              const f = families.find((x) => x.id === p.familyId);
              if (f) onFamily(f);
              setPrompt(p.prompt);
            }}
            onClear={() => {
              setPreset(null);
              setPrompt("");
            }}
            onClose={() => setPickPreset(false)}
          />
        )}

        {/* The model's actual slots, not a picture of an upload area.
            This card used to be three static icons over "افزودن فایل / تصویر،
            ویدیو یا صدا" — decoration. It accepted nothing, and the catalogue's
            own slots never reached the screen, so a customer on a model that
            *requires* a character image had no way to give it one.

            Grouped the way the reference groups them: a frame is a position in
            the clip and a reference is material to draw from, they are different
            questions, and the tabs ask them separately. One group means no tabs
            — a tab strip with a single tab is a label pretending to be a
            choice. */}
        {slots.length > 0 && (
          <Card className="p-3">
            {/* A segmented control, and a radiogroup rather than a tablist.
                The reference marks these as radios and its canvas tabs as a
                tablist, which is the right split: this picks a *value* — which
                kind of input you are giving — while History / How-it-works moves
                between panels. Two loose text buttons said neither. */}
            {groups.length > 1 && (
              <div
                role="radiogroup"
                aria-label={t("ref_kind")}
                className="mb-3 flex gap-1 rounded-lg p-1"
                style={{ background: "var(--vg-deep)" }}
              >
                {groups.map((g) => (
                  <button
                    key={g}
                    role="radio"
                    aria-checked={activeTab === g}
                    onClick={() => setRefTab(g)}
                    className="h-7 flex-1 rounded-md text-[12px] font-semibold transition-colors"
                    style={{
                      background: activeTab === g ? "var(--vg-surface-overlay)" : "transparent",
                      color: activeTab === g ? "var(--vg-text)" : "var(--vg-text-muted)",
                    }}
                  >
                    {t(g === "frame" ? "ref_frames" : "ref_references")}
                  </button>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {shownSlots.map((slot) => (
                <div key={slot.key} className={pairs && isImageSlot(slot) ? undefined : "col-span-2"}>
                  <RefUpload
                    slot={slot}
                    images={refImages[slot.key] ?? []}
                    onChange={(files) => setRefImages((prev) => ({ ...prev, [slot.key]: files }))}
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

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
                    background: input[c.key] ? "var(--vg-primary-a14)" : "var(--vg-surface-overlay)",
                    color: input[c.key] ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                  }}
                >
                  {c.label}: {valueLabel(c, input)}
                </button>
              ))}
          </div>
        </Card>

        {/* The model row opens the model picker — a different component from the
            cover's "تغییر", because it is a different decision. */}
        <div ref={modelRow}>
          <Card>
            <RowSelect label="مدل" value={`${family.name} · ${variant.label}`} onClick={() => setPickModel((v) => !v)} />
          </Card>
        </div>
        {pickModel && (
          <ModelPicker
            anchor={modelRow.current}
            families={families}
            family={family}
            variant={variant}
            onPickFamily={onFamily}
            onPickVariant={s.setVariant}
            onClose={() => setPickModel(false)}
          />
        )}

        {/* No variant strip.
            The row above opens `ModelPicker`, which lists this family's variants
            and every other family in one panel — its own docstring says so, and
            the image dock has worked that way since. Keeping a second row of
            variant pills under it asked the customer to learn our data model
            (family, then variant) before they could choose a model, and gave two
            controls for one decision. The reference has one row here too. */}

        {/* A fixed set gets a select; a continuous range gets a real slider.
            Seedance takes any duration from 4 to 15 and Kling 2.5 takes 5 or 10
            — collapsing both into a dropdown loses the range on one and would
            offer values the other rejects. The catalog already knows which is
            which; `rangeOf` is just reading it. */}
        {chips
          .filter((c) => c.kind === "slider")
          .map((c) => {
            const r = rangeOf(c)!;
            const v = Number(input[c.key]);
            return (
              <Card key={c.key} className="px-3 py-2.5">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                    {c.label}
                  </span>
                  <span className="text-[13px] font-bold" style={{ color: "var(--vg-primary-soft)" }}>
                    <span className="vg-numeric">{v}</span>
                    {c.unit ? <span className="ms-1 text-[11px] font-normal">{c.unit}</span> : null}
                  </span>
                </div>
                <input
                  type="range"
                  min={r.min}
                  max={r.max}
                  step={r.step}
                  value={v}
                  aria-label={c.label}
                  onChange={(e) => set(c.key, c.asString ? e.target.value : Number(e.target.value))}
                  className="w-full"
                />
                <div className="mt-1 flex justify-between text-[10px]" style={{ color: "var(--vg-text-faint)" }}>
                  <span className="vg-numeric">{r.min}</span>
                  <span className="vg-numeric">{r.max}</span>
                </div>
              </Card>
            );
          })}

        {chips.some((c) => c.kind !== "toggle" && c.kind !== "slider") && (
          <div className="grid grid-cols-3 gap-1.5">
            {chips
              .filter((c) => c.kind !== "toggle" && c.kind !== "slider")
              .map((c) => {
                const opts = c.options.map((o) => ({ value: o.value as string | number, label: o.label }));
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
        {/* A locked model gets an upgrade button, not a disabled create button.
            Greying out the price would tell the user the job is unavailable
            without saying it is their plan or what fixes it — and the moment
            they are most likely to buy is the moment they wanted something. */}
        {locked && !visitor ? (
          <button
            onClick={access.onUpgrade}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-bold"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text)" }}
          >
            <Lock size={14} weight="fill" />
            {need ? (
              <>
                ارتقا به <bdi>{need.name}</bdi>
              </>
            ) : (
              "ارتقای پلن"
            )}
          </button>
        ) : (
          <button
            disabled={!visitor && !ready}
            onClick={() => (visitor ? signIn() : onGenerate(family, variant, prompt.trim(), input))}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14px] font-bold transition-opacity disabled:opacity-35"
            style={{ background: "var(--vg-primary)", color: "var(--vg-text-on-primary)" }}
          >
            <Sparkle size={15} weight="fill" />
            {visitor ? t("visitor_cta") : isSubmitting ? "در حال ثبت…" : "بساز"}
            <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
              <CoinMark size={12} />
              <span className="vg-numeric">{price === null ? "—" : n(price)}</span>
            </span>
          </button>
        )}
        {locked && (
          <p className="mt-1.5 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            <bdi>{family.name}</bdi> در پلن فعلی‌ات نیست.
          </p>
        )}
        {price === null && (
          <p className="mt-1.5 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            این ترکیب قیمت‌گذاری نمی‌شود، پس فروخته نمی‌شود.
          </p>
        )}
        {price !== null && validation.issues[0] && (
          <p className="mt-1.5 text-center text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
            {validation.issues[0].message}
          </p>
        )}
      </div>
    </PanelShell>
  );
}
