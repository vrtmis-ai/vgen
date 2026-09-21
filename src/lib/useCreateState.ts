import { useEffect, useMemo, useState } from "react";
import { carryInput, defaultInput, variantControls, type Control, type Family, type Variant } from "../data/models";
import { dockSlots, entrancesOf, resolveEntrance, toEntranceKeys } from "./refSlots";
import { useAccess } from "./access";
import { unlimitedFit } from "./unlimited";
import { useSpendable } from "../runtime/providers/SessionProvider";
import type { InputMap, RefMap } from "../components/controls";
import { priceCoins } from "../data/pricing";
import { validateGenerationInput } from "../features/generation/validation";
import { useIsMutating } from "@tanstack/react-query";
import { CREATE_GENERATION_MUTATION_KEY } from "../features/generation/useGeneration";

/* The state every create surface needs, and nothing else.
   The three studios look nothing alike — a side panel, a floating glass bar, a
   dock over a waveform grid — but all three hold the same four things and price
   them the same way. Only the arrangement differs, so only the arrangement is
   written three times. */

/** Controls a compact surface can render inline. `text` and `voice` need more
 *  room than a chip; `voice` gets its own affordance on the audio studio. */
export type ChipControl = Extract<Control, { kind: "aspect" | "segment" | "toggle" | "slider" }>;

export function chipControls(controls: Control[]): ChipControl[] {
  return controls.filter(
    (c): c is ChipControl =>
      !("advanced" in c && c.advanced) && (c.kind === "aspect" || c.kind === "segment" || c.kind === "toggle" || c.kind === "slider"),
  );
}

export function valueLabel(c: ChipControl, input: InputMap): string {
  const v = input[c.key];
  if (c.kind === "toggle") return v ? "روشن" : "خاموش";
  if (c.kind === "slider") return `${v}${c.unit ? ` ${c.unit}` : ""}`;
  return c.options.find((o) => o.value === String(v))?.label ?? String(v ?? c.def);
}

/** A slider rendered as a menu. Fine steps produce a scroll rather than a menu,
 *  so anything over eight stops is thinned to eight.
 *
 *  Only for surfaces that cannot show a real slider. Where one fits, use
 *  `rangeOf` instead — thinning a 4-to-15-second range down to eight stops
 *  quietly removes seconds the model will happily accept. */
export function sliderSteps(c: Extract<Control, { kind: "slider" }>): number[] {
  const out: number[] = [];
  for (let v = c.min; v <= c.max + 1e-9; v += c.step) out.push(Number(v.toFixed(4)));
  return out.length > 8 ? out.filter((_, i) => i % Math.ceil(out.length / 8) === 0) : out;
}

/**
 * The range behind a chip, or null if the control is a fixed set.
 *
 * This is the whole distinction the catalog already draws and the UI was
 * throwing away: Seedance takes any duration from 4 to 15, Kling 2.5 takes 5 or
 * 10 and nothing else. One deserves a bar you drag; the other must stay a list,
 * because a slider there would offer seven values the provider rejects.
 */
export function rangeOf(c: ChipControl): { min: number; max: number; step: number; unit?: string | undefined; title: string } | null {
  if (c.kind !== "slider") return null;
  return { min: c.min, max: c.max, step: c.step, unit: c.unit, title: c.label };
}

/* ---------------------------------------------------------------------------
   Row metadata for the model picker.

   The reference's picker does not list names — each row carries the ceiling
   that actually decides whether the model is the right one: top resolution and
   the length range it will produce. Ours has the same facts in the catalog and
   was throwing them away, printing "name · vendor" instead.
   --------------------------------------------------------------------------- */

export interface VariantMeta {
  /** Best resolution the variant offers, e.g. "4K". Null when it has no choice. */
  topRes: string | null;
  /** Length range as the reference writes it, e.g. "۴s-۱۵s". Null for stills. */
  range: string | null;
}

export function variantMeta(family: Family, variant: Variant): VariantMeta {
  const controls = variantControls(family, variant);

  // Resolution goes by the LAST option, not the largest number: the catalog
  // already lists them ascending, and "4K" does not sort above "1080p" as text.
  const res = controls.find((c) => c.kind === "segment" && (c.key === "resolution" || c.key === "mode" || c.key === "quality"));
  const topRes = res?.kind === "segment" ? (res.options[res.options.length - 1]?.label ?? null) : null;

  const dur = controls.find((c) => c.key === "duration");
  let range: string | null = null;
  if (dur?.kind === "slider") range = `${dur.min}s-${dur.max}s`;
  else if (dur?.kind === "segment") {
    const vals = dur.options.map((o) => Number(o.value)).filter((v) => !Number.isNaN(v));
    if (vals.length) range = vals.length === 1 ? `${vals[0]}s` : `${Math.min(...vals)}s-${Math.max(...vals)}s`;
  }

  return { topRes, range };
}

/**
 * @param refs Files the surface has picked for this model's input slots.
 *
 * Optional only because the audio dock has no slots to fill. It is not a detail
 * a caller may leave out: this was hardcoded to `{}`, so a model with a
 * `required` slot — Recraft, Topaz — reported `reference_required` no matter
 * what had been attached, and `ready` was false for as long as it stayed
 * selected. The create button was permanently dead on those models on every
 * surface that uses this hook, with nothing on screen saying why.
 */
export function useCreateState(families: Family[], refs: RefMap = {}) {
  const access = useAccess();
  const isSubmitting = useIsMutating({ mutationKey: CREATE_GENERATION_MUTATION_KEY }) > 0;
  /**
   * Open on the flagship, which is what the catalogue is ordered by.
   *
   * This used to hunt for the first model the account's plan could reach,
   * because opening on a padlock was the product's first frame telling you
   * what you could not have. There are no padlocks: every model is open to
   * every account and the wallet is the only thing in the way, so the first
   * family is simply the best one.
   */
  const opening = (fs: Family[]) => fs[0]!;

  const [family, setFamily] = useState<Family>(() => opening(families));
  const [variantId, setVariantId] = useState<string>(() => opening(families).variants[0]!.id);
  const [prompt, setPrompt] = useState("");

  // A modality switch swaps the whole catalog, so the held family may no longer
  // belong to it.
  useEffect(() => {
    if (!families.some((f) => f.id === family.id)) setFamily(opening(families));
  }, [families, family.id]);

  /**
   * The variant, not `variants[0]`.
   *
   * Thirteen of the eighteen families carry more than one — Kling has six, Wan
   * five — and they are separate models with separate prices, not cosmetic
   * labels. Pinning the first one made most of the catalog unreachable and
   * quoted a price for something the user had not chosen.
   *
   * Held by id rather than by object so a family change cannot leave a variant
   * belonging to the previous family in state; the lookup falls back to the new
   * family's first, which is the only sane default.
   */
  const picked: Variant = family.variants.find((v) => v.id === variantId) ?? family.variants[0]!;

  /* The variant that actually runs. For most models that is the one picked;
     for a model with entrances (#96) it is whichever the attachments call for,
     and the dock holds its files by role so they can follow it. `refs` is in
     role keys then, and `submitRefs` is the same files under the running
     entrance's own keys — what validation checks and what gets sent. */
  const entrances = useMemo(() => entrancesOf(family, picked), [family, picked]);
  const grouped = entrances.length > 1;
  const slots = useMemo(() => dockSlots(family, entrances), [family, entrances]);
  const filled = Object.fromEntries(Object.entries(refs).map(([key, files]) => [key, files.length]));
  const variant: Variant = grouped ? resolveEntrance(family, entrances, filled) : picked;
  const submitRefs = grouped ? toEntranceKeys(family, variant, refs) : refs;

  // Keep the id honest after a family change, so the chip and the price agree.
  useEffect(() => setVariantId(family.variants[0]!.id), [family]);

  const controls = useMemo(() => variantControls(family, variant), [family, variant]);
  const [input, setInput] = useState<InputMap>(() => defaultInput(controls));

  // A different control set means different keys, and the provider answers
  // unknown ones with a 422 — so only what the new controls still accept is
  // kept. Keeping it matters now that attaching a file can switch the entrance
  // under somebody who has already picked a ratio and a length.
  useEffect(() => setInput((previous) => carryInput(controls, previous)), [controls]);

  /**
   * Which pipe the customer would rather be served through.
   *
   * Held per dock rather than per variant: switching model keeps the intent —
   * somebody who said "I would rather wait than spend" still means it after
   * trying a different engine — and `unlimitedFit` decides on every render
   * whether that intent is reachable, so a variant without the pipe simply
   * shows no switch rather than silently carrying a stale true.
   */
  const [preferUnlimited, setPreferUnlimited] = useState(false);

  const price = priceCoins(variant, input, { chars: prompt.length, clipSeconds: 0 });
  const validation = validateGenerationInput({ family, variant, prompt, input, refs: submitRefs });

  /* Free through the flat-fee pipe, as this account is set up right now. Read
     here rather than in each dock because it decides the price the button
     shows and whether the balance matters at all — a generation the pipe
     serves costs nothing, so an empty wallet is no reason to refuse it. */
  const freeNow = preferUnlimited && unlimitedFit(variant, input, access.tier)?.available === true;

  /* The wallet, checked before the press rather than after it.
     The server refuses an unaffordable generation — `insufficient_credits`,
     and the hold it takes is what really enforces it — but the customer found
     that out by pressing a lit button and watching it fail. This is the same
     rule, said earlier. Null balance is a visitor or a test harness: neither
     is short of coins, they are asked to sign in instead. */
  const spendable = useSpendable();
  const short = !freeNow && price !== null && spendable !== null && price > spendable;

  /* `short` is deliberately **not** in here. A balance that is too small does
     not make the button unpressable — it makes the press answer «سکه کافی
     نیست» instead of starting a job. A disabled primary control is the one
     thing on the dock that cannot say why it is dark, and on a phone there is
     no hover to recover that; the press is the one moment attention is
     guaranteed to be on it. Owner's call, 2026-09-20. */
  const ready = validation.valid && price !== null && !isSubmitting;

  return {
    family,
    setFamily,
    /** The variant that runs — for a model with entrances, the one the attachments call for. */
    variant,
    /** What was picked in the picker. For a model with entrances this is the entry, and it
     *  does not change when an attachment resolves a different one — which is what a surface
     *  clearing its files on a model switch has to key off. */
    pickedId: picked.id,
    setVariant: (id: string) => setVariantId(id),
    /** More than one is worth a control; exactly one is noise. Entrances are not models. */
    hasVariants: family.variants.filter((v) => !v.entryOf).length > 1,
    /** The upload slots to draw: the model's own, or its entrances' merged by role. */
    slots,
    /** The attached files under the running variant's keys — what to submit. */
    submitRefs,
    controls,
    chips: chipControls(controls),
    input,
    set: (k: string, v: string | number | boolean) => setInput((p) => ({ ...p, [k]: v })),
    prompt,
    setPrompt,
    price,
    /** Coins this account holds, or null for a visitor. */
    spendable,
    /** The price is above the balance, so the button cannot be pressed. */
    short,
    /** This one is free through the unlimited pipe as currently set. */
    freeNow,
    preferUnlimited,
    setPreferUnlimited,
    ready,
    validation,
    isSubmitting,
  };
}
