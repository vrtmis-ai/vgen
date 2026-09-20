import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSession, useSpendable } from "../runtime/providers/SessionProvider";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, CaretDown, Sparkle, X } from "@phosphor-icons/react";
import { defaultInput, variantControls, variantRefs, variantMaxPrompt, type Family, type ModelKind, type Variant } from "../data/models";
import { priceCoins, priceRefusal } from "../data/pricing";
import { CoinMark } from "../components/chrome";
import { useI18n } from "../lib/i18n";
import { ControlField, type InputMap, type InputValue, type RefFile, type RefMap } from "../components/controls";
import { VendorMark } from "../components/VendorMark";
import { Panel, PanelHead, PanelShell, Section } from "../components/Panel";
import { RefBox } from "../components/RefBox";
import { useIgnition } from "../components/Ignition";
import { FailedVeil, RunningVeil, SubmitRefusalNote, type CancelOutcome } from "../components/GenerationVeils";
import { OutputActions } from "../components/OutputActions";
import { GenerationMedia } from "../components/GenerationMedia";
import { displayAspect, isUnfinished, type Generation } from "../lib/gallery";
import { promptCap, useAutoGrow } from "../lib/useAutoGrow";
import { PromptExpandButton } from "../components/PromptExpand";
import { useRevealArrival } from "../lib/useRevealArrival";
import { allTags, insertTag, refTags, tagUsed } from "../lib/refTags";
import { isVideoUrl, labelDir, promptDir } from "../lib/format";
import { useImageFallback } from "../lib/useImageFallback";
import {
  generationErrorMessage,
  shortfallRefusal,
  validateGenerationInput,
  type GenerationRefusal,
} from "../features/generation/validation";
import { ApiError } from "../adapters/http/client";

/**
 * What to ask for, in the words the studio for that kind already uses.
 *
 * This screen is reached from an effect tile or a model link and covers all
 * three kinds, so it cannot ask for "a scene" when the model makes speech. The
 * strings are the studios' own — StudioImage, FormPanel and StudioAudio — so a
 * customer who arrives here instead of there is asked the same question.
 */
const PROMPT_PLACEHOLDER: Record<ModelKind, string> = {
  image: "تصویری که در ذهن داری را توصیف کن.",
  video: "صحنه‌ات را با جزئیات توصیف کن.",
  audio: "دقیقاً همان چیزی که می‌خواهی خوانده شود.",
};

export interface GenerationReceipt {
  coins: number;
  expiresAt: number;
}

/** One of the account's own finished generations, carried in as an input. */
export interface StartFrame {
  /** What the quote names it by. The URL is signed and cannot be stored. */
  assetId: string;
  /** For the preview only, so the user can see which frame came with them. */
  url: string;
  kind: "image" | "video" | "audio";
}

/**
 * A file this form arrives holding, and the slot it goes in.
 *
 * Two things produce these and they differ in who chooses the slot. "To video"
 * hands over one finished output and the slot is inferred from its media kind,
 * because the user picked a model, not a field. "Generate again" replays a past
 * generation, where the slot is a fact about what actually ran — a first frame
 * that comes back as a last frame is a different generation.
 */
export interface CarriedRef {
  slot: string;
  assetId: string;
  url: string;
  kind: "image" | "video" | "audio" | "document";
  /** What the tile says it is, under the thumbnail. */
  label: string;
}

/** Everything a past generation needs to run again exactly as it ran. */
export interface Reuse {
  /** The generation being replayed. Identity, so it is applied once and not per render. */
  jobId: string;
  variantId: string;
  /** The submitted settings, prompt already taken out. */
  input: InputMap;
  references: CarriedRef[];
}

/**
 * One model's own page: the dock that drives it, and what it has made.
 *
 * Every model link and every effect tile lands here, so for a lot of people
 * this is the product. It used to be a single column of form controls on a
 * 1100px page with nothing else on it — no output, no history, nothing to come
 * back to — while the three studios had been rebuilt around a dock and a
 * canvas. It is that shape now, for one model: the same panel, the same
 * reference box, the same lit button, and beside it everything this account has
 * made with this model.
 */
export default function Generate({
  family,
  initialVariantId,
  initialPrompt,
  startFrom,
  reuse,
  onBack,
  onGenerate,
  gens = [],
  onOpen,
  onRemove,
  onCancel,
  onRegenerate,
  onToVideo,
  onErrorAction,
}: {
  family: Family;
  initialVariantId?: string | undefined;
  initialPrompt?: string | undefined;
  /**
   * "To video": the image the user pressed the button on, already in our store.
   *
   * It fills the first slot of this variant that accepts its kind, rather than
   * a named one, because the slot differs per model — `input_urls` on Seedance
   * 1.5 Pro, `reference_image_urls` on 2.5, `image_url` on Hailuo — and the
   * variant can be changed after arriving here.
   */
  startFrom?: StartFrame | undefined;
  /**
   * "Generate again": a past generation of this account's, to be run as it was.
   *
   * Distinct from `startFrom`, which turns an *output* into the next input.
   * This restores the original *inputs* — the variant, the settings and the
   * files it ran against — so the second run is the same order as the first
   * rather than the same prompt at whatever the form currently defaults to.
   */
  reuse?: Reuse | undefined;
  onBack: () => void;
  onGenerate: (
    prompt: string,
    input: InputMap,
    variant: Variant,
    refs: RefMap,
    assetRefs: Record<string, string[]>,
  ) => Promise<GenerationReceipt | null>;
  /** The account's generations; this page draws its own model's. */
  gens?: Generation[] | undefined;
  onOpen?: ((generation: Generation) => void) | undefined;
  /** Offered on a refused generation only, as in کارهای من. */
  onRemove?: ((generation: Generation) => void) | undefined;
  /** Offered on a queued generation only, and only where the API has it. */
  onCancel?: ((generation: Generation) => Promise<CancelOutcome>) | undefined;
  /** The action rail on a finished card. */
  onRegenerate?: ((generation: Generation) => void) | undefined;
  onToVideo?: ((generation: Generation) => void) | undefined;
  /** Where a refusal that has a way out leads. See `generationErrorAction`. */
  onErrorAction?: ((target: "wallet" | "plans") => void) | undefined;
}) {
  const firstVariant = family.variants.find((v) => v.id === initialVariantId) ?? family.variants[0]!;
  const [variant, setVariant] = useState<Variant>(firstVariant);
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [input, setInput] = useState<InputMap>(() => defaultInput(variantControls(family, firstVariant)));
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [refImages, setRefImages] = useState<RefMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<GenerationReceipt | null>(null);
  const [submitError, setSubmitError] = useState<GenerationRefusal | null>(null);
  const promptBox = useRef<HTMLTextAreaElement>(null);
  // See `useAutoGrow`, and the dock this page's panel is modelled on.
  const [promptOpen, setPromptOpen] = useState(false);
  const promptWants = useAutoGrow(promptBox, prompt, promptCap(promptOpen, 21));
  const promptOverflows = promptWants > promptCap(false, 21);
  /* Where the caret goes once an inserted tag has landed in the field. Held in
     a ref and applied in a layout effect, not straight after `setPrompt`: at
     that moment React has not written the new value, so a selection range into
     it is measured against the old text and thrown away — which put the caret
     at the end every time. Same as the dock; see FormPanel. */
  const pendingCaret = useRef<number | null>(null);

  /* Applied in an effect and not in the state initialisers above, for the same
     reason `startFrom` is derived per render: the generations list hydrates
     after first paint, so on a cold load of this URL the first render has no
     `reuse` at all and an initialiser would latch that emptiness for good.

     Keyed by the job so it applies exactly once — after that the controls
     belong to the user, and re-applying would fight them every render.

     Merged over the variant's defaults rather than replacing them: a control
     the original job never set should keep its default, not go missing. */
  const appliedReuse = useRef<string | null>(null);
  useEffect(() => {
    if (!reuse || appliedReuse.current === reuse.jobId) return;
    appliedReuse.current = reuse.jobId;
    const original = family.variants.find((candidate) => candidate.id === reuse.variantId);
    if (original) setVariant(original);
    setInput((current) => ({ ...current, ...reuse.input }));
  }, [family, reuse]);

  // Object URLs are process-wide; without this every picked image leaks until reload.
  const liveRefs = useRef<RefMap>(refImages);
  useEffect(() => {
    liveRefs.current = refImages;
  }, [refImages]);
  useEffect(() => () => revokeAll(liveRefs.current), []);

  const controls = variantControls(family, variant);
  const refs = variantRefs(family, variant);
  const maxPrompt = variantMaxPrompt(family, variant);
  const basic = useMemo(() => controls.filter((c) => !("advanced" in c && c.advanced)), [controls]);
  const advanced = useMemo(() => controls.filter((c) => "advanced" in c && c.advanced), [controls]);
  const multiVariant = family.variants.length > 1;

  function selectVariant(v: Variant) {
    setVariant(v);
    setInput(defaultInput(variantControls(family, v)));
    setShowAdvanced(false);
    // slots differ per variant, so carrying picks over would mis-key them
    revokeAll(refImages);
    setRefImages({});
  }

  const setValue = (key: string, val: InputValue) => setInput((p) => ({ ...p, [key]: val }));

  /* The carried frame and its slot, both derived on every render. Dismissal is
     the only part held in state.

     Holding the frame itself in `useState(startFrom)` looked equivalent and was
     not: the generations list hydrates from localStorage in an effect, so a
     cold load of this URL renders once with no list, `startFrom` undefined, and
     a state initialiser latches that undefined forever — the frame arrives a
     tick later and is never seen again.

     Resolving the slot per render pays a second way: the slot lists differ per
     variant, so switching model re-answers "which field does this go in" for
     free, where a copy would keep naming the old variant's key.

     Dismissable, because arriving with an attachment you did not ask for and
     cannot remove is worse than arriving with none. */
  /* Dismissal is by asset rather than a single flag, now that more than one
     file can arrive: replaying a first-and-last-frame generation carries two,
     and one boolean would drop both to remove either. */
  const [dismissed, setDismissed] = useState<readonly string[]>([]);

  /* "To video" hands over one output and lets the slot be inferred from its
     media kind — the user chose a model, not a field, and the slot names differ
     per variant. "Generate again" already knows the slot, because it is
     replaying what actually ran, and a first frame that comes back as a last
     frame is a different generation. */
  const startFrameSlot = startFrom ? refs.find((slot) => (slot.media ?? "image") === startFrom.kind) : undefined;
  const carriedRefs: CarriedRef[] = (
    startFrom && startFrameSlot
      ? [{ slot: startFrameSlot.key, assetId: startFrom.assetId, url: startFrom.url, kind: startFrom.kind, label: "فریم شروع" }]
      : (reuse?.references ?? [])
  ).filter((reference) => !dismissed.includes(reference.assetId) && refs.some((slot) => slot.key === reference.slot));

  const assetRefs: Record<string, string[]> = {};
  for (const reference of carriedRefs) (assetRefs[reference.slot] ??= []).push(reference.assetId);

  // Some models (image-to-video) are rejected outright without their input image.
  // Blocking here is cheaper than letting the provider 422 a paid job.
  // Either source fills a slot: a carried frame is as present as a picked file.
  const filled = (key: string) => (refImages[key]?.length ?? 0) + (assetRefs[key]?.length ?? 0) > 0;
  // Name the slot that's actually missing — "needs an input image" is wrong and
  // confusing when the empty one is a video.
  const missingRequired = refs.find((s) => s.required && !filled(s.key));
  // A slot that depends on another: an end frame with no start frame is rejected.
  const orphan = refs.find((s) => s.requires && filled(s.key) && !filled(s.requires));
  const orphanNeeds = orphan && refs.find((s) => s.key === orphan.requires);
  const { t, n } = useI18n();
  const { user, signIn } = useSession();
  const visitor = user === null;
  const [coverFailed, onCoverError] = useImageFallback();
  // Two model families price off something other than their settings: speech
  // bills per 1000 characters of prompt, Motion Control per second of the
  // attached clip. Both used to arrive through one argument, so this had to pick
  // one and pass the other as a stand-in — and with no clip yet it passed the
  // prompt's length, quoting Motion Control at 27 credits per character typed.
  // They travel separately now; a model reads whichever it declares.
  const chars = prompt.trim().length;
  const videoFiles = refs.flatMap((s) => (s.media === "video" ? (refImages[s.key] ?? []) : []));
  // KIE bills whole seconds and `duration` is a float, so round up: quoting a
  // 7.36s clip at 7.36 × the per-second rate loses the fraction on every job.
  const clipSeconds = videoFiles.reduce((longest, f) => Math.max(longest, Math.ceil(f.duration ?? 0)), 0);
  const price = priceCoins(variant, input, { chars, clipSeconds });
  // Both mean "no number to show", and they are not the same thing to say. A
  // refusal is the catalogue declining to sell a combination; anything else is
  // our price list missing a row the catalogue still offers, which is a bug and
  // should not be dressed up as a deliberate limit.
  const refusal = price == null ? priceRefusal(variant, input, { chars, clipSeconds }) : null;
  // .mkv and iPhone HEVC .mov are both in the accept list and neither decodes
  // reliably in a browser, so `duration` can come back undefined. On a per-second
  // model that number *is* the price, and substituting anything for it sells a
  // job at a made-up figure. Probe whether this model actually reads it — a
  // first-frame clip on Wan is not priced by its length, and blocking there
  // would be a dead button for no reason.
  const clipUnreadable =
    videoFiles.some((f) => f.duration == null) &&
    priceCoins(variant, input, { chars, clipSeconds: 0 }) !== priceCoins(variant, input, { chars, clipSeconds: 1 });
  const validation = validateGenerationInput({ family, variant, prompt, input, refs: refImages, assetRefs });
  /* The same gate as the studios, and the only one left: no model belongs to a
     plan, so a generation is stopped by its price against the balance or by
     nothing. Null is a visitor, who is asked to sign in rather than told they
     are short. This screen has no unlimited switch — the free pipe is offered
     in the image studio — so there is no free case to exempt. */
  const spendable = useSpendable();
  const short = price != null && spendable !== null && price > spendable;
  const shortfall = short && price != null ? shortfallRefusal(price, spendable ?? 0, n) : null;
  /* The balance is not in here. It does not make the button unpressable — it
     makes the press answer «سکه کافی نیست» rather than start a job. See
     `useCreateState`, which the studios read the same rule from. */
  const canGenerate = validation.valid && !clipUnreadable && price != null;
  const ignition = useIgnition();

  /* The references have names — `@Image1`, `@Video3` — and the prompt can point
     at one; see `lib/refTags`. The dock does this too, and a model reached from
     a link rather than from the dock is the same model with the same inputs. */
  const fileCounts = Object.fromEntries(Object.entries(refImages).map(([key, files]) => [key, files.length]));
  const tagList = allTags(refTags(refs, fileCounts));

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

  /* This model's own work, newest first. Not every generation: the canvas
     beside a model's dock answers "what does this thing make for me", and a
     wall of everything is کارهای من, which is one click away in the bar. */
  const mine = gens.filter((generation) => generation.familyId === family.id);
  // On a phone the canvas is under the form, so the job a press made is out of
  // sight the moment it is created.
  const reveal = useRevealArrival(mine[0]?.id);

  async function submit() {
    if (!canGenerate || submitting) return;
    /* Answered from here rather than from the API: the sum is local, so there
       is nothing to ask and nothing to wait for. The notice is the same one a
       server refusal would draw, in the same place. */
    if (shortfall) {
      setSubmitError(shortfall);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    reveal.arm();
    try {
      const nextReceipt = await onGenerate(prompt.trim(), input, variant, refImages, assetRefs);
      if (nextReceipt) setReceipt(nextReceipt);
      else setSubmitError({ code: "invalid_request", message: "درخواست ساخته نشد؛ ورودی‌ها را دوباره بررسی کنید." });
    } catch (error: unknown) {
      setSubmitError({ code: error instanceof ApiError ? error.code : "unknown", message: generationErrorMessage(error) });
    } finally {
      setSubmitting(false);
    }
  }

  /* The line under the button: whichever of these is true first. A missing
     file outranks the price — the reason the button will not work is worth more
     than the number it would have cost. A refusal outranks all of them and is
     not a footnote at all: it is drawn as a notice below, because the faint
     grey this line is set in is the voice of a hint, not of an answer. */
  const footnote = receipt
    ? `هزینهٔ نهایی سرور: ${n(receipt.coins)} · اعتبار قیمت تا ${new Date(receipt.expiresAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`
    : missingRequired
      ? `${t("g_need_also")} ${missingRequired.label}`
      : orphanNeeds
        ? `${t("g_need_also")} ${orphanNeeds.label}`
        : clipUnreadable
          ? t("g_clip_unreadable")
          : validation.issues[0]
            ? validation.issues[0].message
            : price != null
              ? `≈ ${n(price)} ${t("g_est_for")}`
              : t(refusal === "not_offered" ? "g_no_rate" : "g_no_price");

  return (
    /* The studios' own shape: a dock that stays put and a canvas that fills
       the rest, stacking on a phone. Both stand on the page's stage. */
    <div className="flex flex-col md:flex-row md:items-start">
      {/* The page's own title, for a screen reader arriving on a route change.
          The dock names the model on screen. */}
      <h1 className="sr-only">
        ساخت با {family.name} — {family.vendor}
      </h1>

      <PanelShell>
        <div className="flex flex-col gap-2.5 p-2.5">
          {/* This screen has no bar of its own — it is reached from one and
              returns to it — so the way back is the first thing in the column. */}
          <button
            onClick={onBack}
            className="flex h-8 w-fit items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold transition-colors"
            style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
          >
            <ArrowRight size={14} weight="bold" className="ltr:-scale-x-100" />
            {t("g_back")}
          </button>

          <Panel>
            {/* The subject is the model, and the subtitle is whose engine runs
                it — the one fact that is otherwise nowhere on this surface. */}
            <PanelHead
              icon={<Sparkle size={14} weight="fill" />}
              title={family.name}
              sub={<bdi>{family.vendor}</bdi>}
              action={<VendorMark vendor={family.vendor} size={20} />}
            />

            {/* What it makes, before anything is typed. A model page that opens
                on a form asks for a decision the catalogue has already made. */}
            <Section>
              <div className="relative h-[104px] w-full overflow-hidden" style={{ background: family.grad }}>
                {family.cover && !isVideoUrl(family.cover) && !coverFailed && (
                  <img
                    src={family.cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={onCoverError}
                    className="absolute inset-0 size-full object-cover"
                  />
                )}
                <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.7), transparent 60%)" }} />
                <span className="absolute inset-x-2.5 bottom-2 truncate text-[12px] font-semibold" style={{ color: "var(--vg-text)" }}>
                  <bdi>{family.name}</bdi>
                </span>
              </div>
            </Section>

            {/* Variants as one row of pills. The studios open a picker here
                because it also lists every other model; this page is one model,
                so its versions are the only choice on it. */}
            {multiVariant && (
              <Section className="flex flex-wrap gap-1.5 p-2.5">
                {family.variants.map((v) => {
                  const on = v.id === variant.id;
                  return (
                    <button
                      key={v.id}
                      onClick={() => selectVariant(v)}
                      aria-pressed={on}
                      className="flex h-8 items-center gap-1.5 rounded-[7px] px-2.5 text-[12px] font-semibold transition-colors"
                      style={{
                        background: on ? "var(--vg-primary-a14)" : "var(--vg-surface-overlay)",
                        color: on ? "var(--vg-primary-soft)" : "var(--vg-text-muted)",
                      }}
                    >
                      {v.label}
                      {v.badge && (
                        <span className="text-[10px] font-medium" style={{ color: "var(--vg-text-faint)" }}>
                          {v.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </Section>
            )}

            {/* The files that came with the press — a start frame from "to
                video", or everything a replayed generation ran against — each
                in the slot it will fill. Not picked files: the bytes are already
                ours and travel as ids, so they sit beside the box rather than
                inside it. */}
            {carriedRefs.map((reference) => (
              <Section key={reference.assetId} className="flex items-center gap-2.5 p-2.5">
                <span
                  className="relative size-[52px] shrink-0 overflow-hidden rounded-[9px]"
                  style={{ background: "var(--vg-surface-overlay)" }}
                >
                  {reference.kind === "video" ? (
                    <video src={reference.url} muted playsInline preload="metadata" className="size-full object-cover" />
                  ) : (
                    <img src={reference.url} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-semibold" style={{ color: "var(--vg-text)" }}>
                    از کارهای خودت — {reference.label}
                  </span>
                  <span className="block truncate text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                    {refs.find((slot) => slot.key === reference.slot)?.label}
                  </span>
                </span>
                <button
                  onClick={() => setDismissed((current) => [...current, reference.assetId])}
                  aria-label={`حذف ${reference.label}`}
                  title={`حذف ${reference.label}`}
                  className="grid size-7 shrink-0 place-items-center rounded-lg"
                  style={{ background: "var(--vg-surface-overlay)", color: "var(--vg-text-muted)" }}
                >
                  <X size={13} weight="bold" />
                </button>
              </Section>
            ))}

            {/* One box for every slot, routed by what the file is — the dock's
                own control, so an upload behaves the same on both surfaces. */}
            {refs.length > 0 && (
              <Section className="p-2.5">
                <RefBox slots={refs} refs={refImages} onChange={setRefImages} prompt={prompt} onInsertTag={insertAtCaret} />
              </Section>
            )}

            <Section className="px-2.5 py-2">
              {/* Follows the field: `dir="auto"` below sends the text to the
                  other edge the moment a Latin character is typed, and a caption
                  left behind is what makes a symmetric box look wrong. */}
              <div className="mb-1 flex items-baseline justify-between gap-2" dir={labelDir(prompt)}>
                <span className="text-[11px]" style={{ color: "var(--vg-text-muted)" }}>
                  {t("g_prompt")}
                </span>
                {/* Only near the ceiling. Wan 2.5 stops at 800, so there it
                    matters; on a 20000 one it never shows. */}
                {maxPrompt != null && prompt.length > maxPrompt * 0.8 ? (
                  <span className="vg-numeric text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                    {n(prompt.length)} / {n(maxPrompt)}
                  </span>
                ) : (
                  <span className="text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
                    {t("g_prompt_hint")}
                  </span>
                )}
                {(promptOverflows || promptOpen) && (
                  <PromptExpandButton open={promptOpen} onToggle={() => setPromptOpen((open) => !open)} controls="model-prompt" />
                )}
              </div>
              <textarea
                ref={promptBox}
                id="model-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                dir={promptDir(prompt)}
                rows={4}
                maxLength={maxPrompt ?? undefined}
                disabled={family.noPrompt}
                placeholder={family.noPrompt ? "این مدل پرامپت نمی‌گیرد — فقط فایل بده" : PROMPT_PLACEHOLDER[family.kind]}
                className="hide-scrollbar vg-field-inset resize-none bg-transparent text-[12.5px] leading-[1.7] outline-none disabled:opacity-40"
                style={{ color: "var(--vg-text)" }}
              />
              {/* The names of the files above, under the hand that is writing.
                  Lime means the prompt already points at that one. */}
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
            </Section>

            {basic.map((c) => (
              <Section key={c.key} className="px-2.5 py-2.5">
                <ControlField control={c} value={input[c.key]} onChange={setValue} />
              </Section>
            ))}

            {advanced.length > 0 && (
              <Section>
                <button
                  onClick={() => setShowAdvanced((s) => !s)}
                  aria-expanded={showAdvanced}
                  className="flex h-10 w-full items-center justify-between px-2.5 text-[12px]"
                  style={{ color: "var(--vg-text-muted)" }}
                >
                  <span>{t("g_advanced")}</span>
                  <CaretDown size={14} className={`transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence initial={false}>
                  {showAdvanced && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      {advanced.map((c) => (
                        <div key={c.key} className="px-2.5 pb-2.5" style={{ borderBlockStart: "1px solid var(--vg-border-subtle)" }}>
                          <div className="pt-2.5">
                            <ControlField control={c} value={input[c.key]} onChange={setValue} />
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </Section>
            )}
          </Panel>
        </div>

        {/* Pinned to the panel floor rather than scrolled with the stack: it is
            the only thing on this surface the user is guaranteed to want. */}
        <div
          className="sticky bottom-0 mt-auto p-2.5"
          style={{ background: "var(--vg-canvas)", borderBlockStart: "1px solid var(--vg-border-subtle)" }}
        >
          {/* Above the button, not under it — the footer is pinned to the
              panel floor, so a box below would lift the button away from the
              pointer that just pressed it. See `SubmitRefusalNote`. */}
          {submitError && <SubmitRefusalNote refusal={submitError} onAction={onErrorAction} className="mb-2" />}
          {/* No standing notice beside the button: the price is already on it,
              and a permanently red dock nags somebody who is still writing. */}
          {/* No model belongs to a plan any more: what stops a generation is
              the price against the balance. */}
          {/* The same field as the studios' «بساز» — every button that spends
              coins on a generation lights the same way. See `useIgnition`. */}
          <button
            onClick={(event) => (visitor ? signIn() : ignition.ignite(event, () => void submit()))}
            disabled={!visitor && (!canGenerate || submitting)}
            aria-busy={ignition.igniting || submitting || undefined}
            className="relative flex h-11 w-full items-center justify-center overflow-hidden rounded-[10px] text-[14px] font-bold transition-opacity disabled:opacity-35"
            style={{
              background: "var(--vg-primary)",
              // Light ink over the dark field, with a halo for the moment the
              // label still sits half on lime — as the dock does.
              color: ignition.igniting ? "var(--vg-text)" : "var(--vg-text-on-primary)",
              textShadow: ignition.igniting ? "0 0 6px rgb(0 0 0 / 0.7)" : undefined,
              boxShadow: !visitor && (!canGenerate || submitting) ? "none" : "var(--vg-glow-primary)",
            }}
          >
            {ignition.layer}
            {/* Positioned so it paints above the field. */}
            <span className="relative flex items-center gap-2">
              <Sparkle size={15} weight="fill" />
              {visitor ? t("visitor_cta") : submitting ? "در حال ثبت…" : t("g_create")}
              {price != null && !clipUnreadable && (
                <span className="flex items-center gap-1 text-[12.5px] font-semibold opacity-90">
                  <CoinMark size={12} />
                  <span className="vg-numeric">{n(price)}</span>
                </span>
              )}
            </span>
          </button>
          <p className="mt-1.5 text-center text-[10.5px]" style={{ color: "var(--vg-text-faint)" }}>
            {footnote}
          </p>
        </div>
      </PanelShell>

      {/* The canvas: what this model has made for this account. */}
      <main
        className="@container min-w-0 flex-1 px-4 pb-16 pt-5 md:px-8"
        style={{ borderInlineStart: "1px solid var(--vg-border-subtle)" }}
      >
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold" style={{ color: "var(--vg-text)" }}>
            خروجی‌های این مدل
          </h2>
          {mine.length > 0 && (
            <span className="vg-numeric text-[11px]" style={{ color: "var(--vg-text-faint)" }}>
              {n(mine.length)}
            </span>
          )}
        </div>

        {mine.length === 0 ? (
          /* Empty, not blank. The model's own name carries the Latin ghost
             label the design system added for exactly this — Persian has no
             uppercase to buy presence with. */
          <div className="mx-auto max-w-[560px] py-10 text-center">
            <span className="t-ghost block" lang="en">
              {family.name}
            </span>
            <h3 className="t-h1 mt-2 text-balance">هنوز با این مدل چیزی نساخته‌ای</h3>
            <p className="t-caption mx-auto mt-2 max-w-[44ch] text-pretty" style={{ color: "var(--vg-text-muted)" }}>
              هرچه اینجا بسازی همین‌جا می‌ماند و در کارهای من هم هست.
            </p>
          </div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}>
            {mine.map((generation) => {
              const shape = displayAspect(generation);
              const target = generation.id === mine[0]?.id ? reveal.target : undefined;
              const frame = { aspectRatio: `${shape.w} / ${shape.h}`, background: generation.grad };
              /* A card with a control on it cannot be a button: a button inside
                 a button is invalid markup that browsers resolve by dropping
                 one of them. That is the refused card's remove control and the
                 queued card's cancel — and a queued generation has nothing to
                 open until it starts. */
              if (isUnfinished(generation.status) || generation.status === "queued") {
                return (
                  <div
                    key={generation.id}
                    ref={target}
                    className="relative scroll-my-24 overflow-hidden rounded-[14px]"
                    style={{ ...frame, border: "1px solid var(--vg-border-subtle)" }}
                  >
                    {isUnfinished(generation.status) ? (
                      <FailedVeil gen={generation} onRemove={onRemove ? () => onRemove(generation) : undefined} />
                    ) : (
                      <RunningVeil gen={generation} onCancel={onCancel} />
                    )}
                  </div>
                );
              }
              return (
                // The rail has buttons of its own, so the card is a box with an
                // open button filling it rather than a button itself.
                <div
                  key={generation.id}
                  ref={target}
                  data-generation-card
                  className="group relative scroll-my-24 overflow-hidden rounded-[14px] text-start"
                  style={{ ...frame, border: "1px solid var(--vg-border-subtle)" }}
                >
                  <button
                    type="button"
                    onClick={() => onOpen?.(generation)}
                    aria-label={`باز کردن — ${generation.prompt.trim().slice(0, 60) || generation.name}`}
                    className="absolute inset-0"
                  >
                    <GenerationMedia gen={generation} />
                  </button>
                  {generation.status === "running" && <RunningVeil gen={generation} />}
                  {generation.status === "done" && (
                    <OutputActions
                      gen={generation}
                      {...(onOpen ? { onOpen: () => onOpen(generation) } : {})}
                      {...(onRegenerate ? { onRegenerate: () => onRegenerate(generation) } : {})}
                      {...(onToVideo ? { onToVideo: () => onToVideo(generation) } : {})}
                    />
                  )}
                  {generation.prompt && generation.status === "done" && (
                    <span
                      className="absolute inset-x-0 bottom-0 p-2"
                      style={{ background: "linear-gradient(to top, rgb(0 0 0 / 0.72), transparent)" }}
                    >
                      <span className="ltr line-clamp-2 block text-[11px] leading-snug" style={{ color: "var(--vg-text-secondary)" }}>
                        {generation.prompt}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/** Drop every thumbnail URL in a RefMap. The underlying File objects stay usable. */
function revokeAll(map: RefMap) {
  for (const imgs of Object.values(map)) for (const img of imgs as RefFile[]) URL.revokeObjectURL(img.url);
}
