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
 *  so anything over eight stops is thinned to eight. */
export function sliderSteps(c: Extract<Control, { kind: "slider" }>): number[] {
  const out: number[] = [];
  for (let v = c.min; v <= c.max + 1e-9; v += c.step) out.push(Number(v.toFixed(4)));
  return out.length > 8 ? out.filter((_, i) => i % Math.ceil(out.length / 8) === 0) : out;
}

export function useCreateState(families: Family[]) {
  const [family, setFamily] = useState<Family>(() => families[0]!);
  const [prompt, setPrompt] = useState("");

  // A modality switch swaps the whole catalog, so the held family may no longer
  // belong to it.
  useEffect(() => {
    if (!families.some((f) => f.id === family.id)) setFamily(families[0]!);
  }, [families, family.id]);

  const variant: Variant = family.variants[0]!;
  const controls = useMemo(() => variantControls(family, variant), [family, variant]);
  const [input, setInput] = useState<InputMap>(() => defaultInput(controls));

  // A different family means a different control set. Carrying the old keys over
  // is not merely stale — the provider answers unknown keys with a 422.
  useEffect(() => setInput(defaultInput(controls)), [controls]);

  const price = priceCoins(variant, input, { chars: prompt.length, clipSeconds: 0 });
  const ready = (family.noPrompt || prompt.trim().length > 0) && price !== null;

  return {
    family,
    setFamily,
    variant,
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
