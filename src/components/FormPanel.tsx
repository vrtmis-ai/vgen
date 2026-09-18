import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSession } from "../runtime/providers/SessionProvider";
import { CaretLeft, Lock, Sparkle, PencilSimple } from "@phosphor-icons/react";
import { type Family, type Variant, variantRefs } from "../data/models";
import { type InputMap, type RefMap } from "./controls";
import { RefBox } from "./RefBox";
import { useIgnition } from "./Ignition";
import { allTags, insertTag, refTags, tagUsed } from "../lib/refTags";
import { useCreateState, valueLabel, rangeOf } from "../lib/useCreateState";
import { ModelPicker } from "./ModelPicker";
import { PresetPicker } from "./PresetPicker";
import type { Preset } from "../runtime/contracts/content";
import { labelDir, promptDir } from "../lib/format";
import { Panel, PanelHead, PanelShell, Section } from "./Panel";
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
 * The cover, and nothing else.
 *
 * It used to carry the preset's name in 15px extrabold lime over the picture,
 * with the model under it. Both have moved into the panel head, for two
 * reasons. The name over artwork was legible only because of a 78% scrim —
 * eight tenths of the picture darkened so four words could sit on it. And it
 * put the panel's subject in the middle of the column instead of at the top of
 * it, which is the reason the dock had no entry point.
 *
 * Lime leaving here matters on its own: `index.css` holds that two accent
 * elements on one screen means one of them is wrong, and this was the second
 * one, competing with the button that actually spends money.
 *
 * Full-bleed: it sits inside the panel now, so a radius and a border here would
 * draw a second edge one pixel inside the panel's own.
 */
function PresetCover({ family, preset, onChange }: { family: Family; preset: Preset | null; onChange: () => void }) {
  const [failed, onError] = useImageFallback();
  const cover = preset ? `https://picsum.photos/seed/${preset.seed}/480/300` : family.cover;
  return (
    <div className="relative aspect-[16/10] overflow-hidden" style={{ background: family.grad }}>
      {cover && !failed && <img src={cover} alt="" onError={onError} className="absolute inset-0 size-full object-cover" />}
      {/* A quarter of the frame, not four fifths: nothing sits on the picture
          now except one button in the corner. */}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.35), transparent 40%)" }} />
      <button
        onClick={onChange}
        aria-label="تغییر افکت"
        className="vg-tap absolute top-2 flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold backdrop-blur-md"
        style={{ insetInlineEnd: "0.5rem", background: "rgba(0,0,0,0.55)", color: "var(--vg-text)" }}
      >
        <PencilSimple size={11} weight="bold" />
        تغییر
      </button>
    </div>
  );
}

export function FormPanel({
  families,
  onGenerate,
}: {
  families: Family[];
  onGenerate: (family: Family, variant: Variant, prompt: string, input: InputMap, refs: RefMap) => void;
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
  const promptBox = useRef<HTMLTextAreaElement>(null);
  /* The sign-in field, lit across «بساز» from the point pressed; the
     submission goes when it has swept the button. See `useIgnition`. */
  const ignition = useIgnition();
  /* Where the caret should sit once an inserted tag has actually landed in the
     field. Held in a ref and applied in a layout effect rather than set
     straight after `setPrompt`: at that moment React has not written the new
     value yet, so a selection range into it is measured against the old text
     and then thrown away when the new one arrives — which put the caret at the
     end every time, and typing carried on in the wrong place. */
  const pendingCaret = useRef<number | null>(null);

  /* Files live here rather than in `useCreateState`, because they are object
     URLs with a lifetime: switching model has to revoke them or the tab leaks a
     blob per upload. Declared above the hook because the hook validates against
     them — a `required` slot is only satisfied by what has actually been
     picked, and passing `{}` is what left the button dead on those models. */
  const [refImages, setRefImages] = useState<RefMap>({});

  // Same hook as the other two studios. This panel used to keep its own copy of
  // family/controls/input/price, which is how it ended up pinned to variants[0]
  // while the shared version moved on.
  const s = useCreateState(families, refImages);
  const { family, variant, chips, input, prompt, price, ready, validation, isSubmitting } = s;
  const access = useAccess();
  const locked = !access.can(family.id);
  const need = locked ? access.needs(family.id) : null;
  const set = s.set;
  const setPrompt = s.setPrompt;
  const onFamily = s.setFamily;

  /* The slots this model actually offers. `variantRefs` resolves the variant's
     own list against the family's, which is how "this variant has no slots"
     (`refs: null`) stays different from "inherit the family's".

     They are not drawn one per upload area any more — see `RefBox`. */
  const slots = variantRefs(family, variant);

  /* The references have names — `@Image1`, `@Video3` — and the prompt can
     point at one. See `lib/refTags`: a prompt that says "the attached image"
     leaves a multi-reference model to guess which input a sentence is about.
     Frames are not named; a start frame is a position, not material. */
  const fileCounts = Object.fromEntries(Object.entries(refImages).map(([key, files]) => [key, files.length]));
  const tagList = allTags(refTags(slots, fileCounts));

  function insertAtCaret(tag: string) {
    const box = promptBox.current;
    const at = box?.selectionStart ?? prompt.length;
    const next = insertTag(prompt, at, tag);
    pendingCaret.current = next.caret;
    setPrompt(next.prompt);
  }

  useLayoutEffect(() => {
    const at = pendingCaret.current;
    if (at === null) return;
    pendingCaret.current = null;
    const box = promptBox.current;
    if (!box) return;
    box.focus();
    box.setSelectionRange(at, at);
  }, [prompt]);

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
      {/* One surface, not eight. The blocks below are divided by hairlines
          rather than by gaps, which is what lets the column read top-to-bottom:
          subject, material, instruction, machine, settings. */}
      <div className="p-2.5">
        <Panel>
          {/* The panel's subject, and whose engine is behind it.
              The subtitle is the vendor rather than the model: the model row
              four blocks down already prints `family · variant`, and a panel
              that says "Seedance · ۲٫۵" twice has told you nothing the second
              time. Provenance is the thing that is otherwise nowhere on this
              surface. */}
          <PanelHead
            icon={<Sparkle size={14} weight="fill" />}
            title={preset ? preset.title : "بدون افکت"}
            sub={<bdi>{family.vendor}</bdi>}
          />

          <Section>
            <PresetCover family={family} preset={preset} onChange={() => setPickPreset(true)} />
          </Section>

          {/* One box, not one upload area per slot.

              This was a labelled area per slot: on Seedance 2.5 that is three
              of them stacked — image, video, audio — taller together than the
              prompt, the model row and every setting combined, in a 342px
              column. And the segmented control above them asked which *kind* of
              input you were about to give, which is the one thing the file
              itself already knows.

              `RefBox` takes anything and routes it by MIME type, and asks the
              only question a file cannot answer — reference, start frame or end
              frame — per file, on the tile, and only on models that have frames.
              Seedance has none; Kling, Veo and Wan do. */}
          {slots.length > 0 && (
            <Section className="p-2.5">
              <RefBox slots={slots} refs={refImages} onChange={setRefImages} prompt={prompt} onInsertTag={insertAtCaret} />
            </Section>
          )}

          <Section className="px-2.5 py-2">
            {/* Follows the field: `dir="auto"` below sends the text to the other
                edge the moment a Latin character is typed, and a caption left on
                the far side is what makes a symmetrically padded box look wrong. */}
            <p className="mb-1 text-[11px]" dir={labelDir(prompt)} style={{ color: "var(--vg-text-muted)" }}>
              پرامپت
            </p>
            <textarea
              ref={promptBox}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              dir={promptDir(prompt)}
              disabled={family.noPrompt}
              placeholder={family.noPrompt ? "این مدل پرامپت نمی‌گیرد — فقط فایل بده" : "صحنه‌ات را با جزئیات توصیف کن."}
              className="hide-scrollbar vg-field-inset resize-none bg-transparent text-[12.5px] leading-[1.7] outline-none disabled:opacity-40"
              style={{ color: "var(--vg-text)" }}
            />
            {/* The names of the files above, under the hand that is writing.
                They are on the tiles too, but the tiles are at the top of the
                panel and this is where you are when you need one. Lime means
                the prompt already points at it. */}
            {tagList.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="shrink-0 text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                  اشاره به
                </span>
                {tagList.map((tag) => {
                  const pointed = tagUsed(prompt, tag);
                  return (
                    <button
                      key={tag}
                      onClick={() => insertAtCaret(tag)}
                      aria-label={`درج ${tag} در پرامپت`}
                      className="vg-tag rounded px-1.5 py-0.5 font-semibold"
                      style={{
                        background: pointed ? "var(--vg-primary-a18)" : "var(--vg-surface-overlay)",
                        color: pointed ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Toggles live inside the prompt card, as small pills on its floor. */}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {chips
                .filter((c) => c.kind === "toggle")
                .map((c) => (
                  <button
                    key={c.key}
                    onClick={() => set(c.key, !input[c.key])}
                    aria-pressed={Boolean(input[c.key])}
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
          </Section>

          {/* The model row opens the model picker — a different component from the
              cover's "تغییر", because it is a different decision. */}
          <div ref={modelRow}>
            <Section>
              <RowSelect label="مدل" value={`${family.name} · ${variant.label}`} onClick={() => setPickModel((v) => !v)} />
            </Section>
          </div>

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
                <Section key={c.key} className="px-2.5 py-2">
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                      {c.label}
                    </span>
                    {/* Plain text, not lime. A duration read-out is not an action
                        and does not compete with the one control that is. */}
                    <span className="text-[12.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
                      {/* Through `n()`, like every other figure in the app. The
                          slider printed Latin digits beside a Persian price and
                          a Persian coin balance. */}
                      <span className="vg-numeric">{n(v)}</span>
                      {c.unit ? (
                        <span className="ms-1 text-[11px] font-normal" style={{ color: "var(--vg-text-muted)" }}>
                          {c.unit}
                        </span>
                      ) : null}
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
                  <div className="mt-0.5 flex justify-between text-[10px]" style={{ color: "var(--vg-text-faint)" }}>
                    <span className="vg-numeric">{n(r.min)}</span>
                    <span className="vg-numeric">{n(r.max)}</span>
                  </div>
                </Section>
              );
            })}

          {/* A wrapping row, not a three-column grid. Most video models expose
              two of these, and a fixed third column left a hole beside them. */}
          {chips.some((c) => c.kind !== "toggle" && c.kind !== "slider") && (
            <Section className="flex flex-wrap gap-1.5 p-2.5">
              {chips
                .filter((c) => c.kind !== "toggle" && c.kind !== "slider")
                .map((c) => {
                  const opts = c.options.map((o) => ({ value: o.value as string | number, label: o.label }));
                  return (
                    <label key={c.key} className="relative block min-w-[84px] flex-1">
                      <span className="sr-only">{c.label}</span>
                      <select
                        value={String(input[c.key])}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const match = opts.find((o) => String(o.value) === raw);
                          set(c.key, match ? match.value : raw);
                        }}
                        className="vg-msel h-8 w-full cursor-pointer appearance-none rounded-[7px] text-center text-[12px] font-semibold outline-none"
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
            </Section>
          )}
        </Panel>
      </div>

      {/* Both pickers portal to the body, so they live outside the panel —
          `Panel` clips its own corners and would clip a popover with them. */}
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

      {/* The button is pinned to the panel floor, not scrolled with the stack.
          It is the only thing on this surface the user is guaranteed to want. */}
      <div
        className="sticky bottom-0 mt-auto p-2.5"
        style={{ background: "var(--vg-canvas)", borderBlockStart: "1px solid var(--vg-border-subtle)" }}
      >
        {/* A locked model gets an upgrade button, not a disabled create button.
            Greying out the price would tell the user the job is unavailable
            without saying it is their plan or what fixes it — and the moment
            they are most likely to buy is the moment they wanted something. */}
        {locked && !visitor ? (
          <button
            onClick={access.onUpgrade}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-[10px] text-[14px] font-bold"
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
            onClick={(event) =>
              visitor ? signIn() : ignition.ignite(event, () => onGenerate(family, variant, prompt.trim(), input, refImages))
            }
            aria-busy={ignition.igniting || undefined}
            className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded-[10px] text-[14px] font-bold transition-opacity disabled:opacity-35"
            style={{
              background: "var(--vg-primary)",
              // Light while the dark field is behind it, or the ink disappears.
              color: ignition.igniting ? "var(--vg-text)" : "var(--vg-text-on-primary)",
              // A dark halo while it is light: the field sweeps in from the
              // pressed point, so for a moment the label sits half on lime.
              textShadow: ignition.igniting ? "0 0 6px rgb(0 0 0 / 0.7)" : undefined,
              /* The bloom is what makes this read as the lit thing on the
                 surface rather than a green rectangle — and it is now the only
                 filled accent in the column, so it can carry that alone. A
                 button that cannot be pressed does not glow. */
              boxShadow: !visitor && !ready ? "none" : "var(--vg-glow-primary)",
            }}
          >
            {ignition.layer}
            {/* Positioned so it paints above the field. */}
            <span className="relative flex items-center gap-2">
              <Sparkle size={15} weight="fill" />
              {visitor ? t("visitor_cta") : isSubmitting ? "در حال ثبت…" : "بساز"}
              <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
                <CoinMark size={12} />
                <span className="vg-numeric">{price === null ? "—" : n(price)}</span>
              </span>
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
