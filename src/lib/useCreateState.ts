import { useEffect, useMemo, useState } from "react";
import {
  defaultInput,
  variantControls,
  type Control,
  type Family,
  type Variant,
} from "../data/models";
import type { InputMap } from "../components/controls";
import { priceCoins } from "../data/pricing";

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
      !("advanced" in c && c.advanced) &&
      (c.kind === "aspect" || c.kind === "segment" || c.kind === "toggle" || c.kind === "slider"),
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
export function rangeOf(
  c: ChipControl,
): { min: number; max: number; step: number; unit?: string | undefined; title: string } | null {
  if (c.kind !== "slider") return null;
  return { min: c.min, max: c.max, step: c.step, unit: c.unit, title: c.label };
}

export function useCreateState(families: Family[]) {
  const [family, setFamily] = useState<Family>(() => families[0]!);
  const [variantId, setVariantId] = useState<string>(() => families[0]!.variants[0]!.id);
  const [prompt, setPrompt] = useState("");

  // A modality switch swaps the whole catalog, so the held family may no longer
  // belong to it.
  useEffect(() => {
    if (!families.some((f) => f.id === family.id)) setFamily(families[0]!);
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
  const variant: Variant = family.variants.find((v) => v.id === variantId) ?? family.variants[0]!;

  // Keep the id honest after a family change, so the chip and the price agree.
  useEffect(() => setVariantId(family.variants[0]!.id), [family]);

  const controls = useMemo(() => variantControls(family, variant), [family, variant]);
  const [input, setInput] = useState<InputMap>(() => defaultInput(controls));

  // A different control set means different keys. Carrying the old ones over is
  // not merely stale — the provider answers unknown keys with a 422. Variants
  // may override controls too, so this has to key off the resolved list.
  useEffect(() => setInput(defaultInput(controls)), [controls]);

  const price = priceCoins(variant, input, { chars: prompt.length, clipSeconds: 0 });
  const ready = (family.noPrompt || prompt.trim().length > 0) && price !== null;

  return {
    family,
    setFamily,
    variant,
    setVariant: (id: string) => setVariantId(id),
    /** More than one is worth a control; exactly one is noise. */
    hasVariants: family.variants.length > 1,
    controls,
    chips: chipControls(controls),
    input,
    set: (k: string, v: string | number | boolean) => setInput((p) => ({ ...p, [k]: v })),
    prompt,
    setPrompt,
    price,
    ready,
  };
}
