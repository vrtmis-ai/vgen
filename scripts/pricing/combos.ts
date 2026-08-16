/**
 * Every settings combination that can change a price, enumerated once.
 *
 * Three things read this and they must agree exactly: the seeder that writes
 * `model_prices`, the generator that freezes the expected prices, and the check
 * that compares the two. If they enumerated separately, a combination missed by
 * one would be a price nobody ever verified.
 */
import { FAMILIES, variantControls, type Control, type Family, type Variant } from "../../src/data/models";
import type { InputMap, InputValue } from "../../src/components/controls";

/**
 * Settings that can select a rate. Varying anything else cannot change a price,
 * so including it would multiply the row count for nothing — and, worse, put a
 * key in the selector that the quote request will not send, so the row would
 * never match.
 */
export const PRICE_KEYS = [
  "resolution",
  "quality",
  "mode",
  "rendering_speed",
  "duration",
  "sound",
  "generate_audio",
  "enable_pro",
  "upscale_factor",
  "character_orientation",
] as const;

const PRICE_KEY_SET = new Set<string>(PRICE_KEYS);
const MAX_SLIDER_STEPS = 20;

export function valuesFor(control: Control): InputValue[] {
  if (control.kind === "segment" || control.kind === "aspect") return control.options.map((option) => option.value);
  if (control.kind === "toggle") return [false, true];
  if (control.kind === "slider") {
    const steps = Math.floor((control.max - control.min) / control.step) + 1;
    const raw =
      steps <= MAX_SLIDER_STEPS
        ? Array.from({ length: steps }, (_, k) => control.min + k * control.step)
        : [control.min, control.def, control.max];
    return raw.map((value) => (control.asString ? String(value) : value));
  }
  return [""];
}

export function defaultOf(control: Control): InputValue {
  if (control.kind === "text") return "";
  if (control.kind === "toggle") return control.def;
  if (control.kind === "slider") return control.asString ? String(control.def) : control.def;
  return control.def;
}

/** The price-relevant controls of a variant, family defaults already merged in. */
export function priceControls(family: Family, variant: Variant): Control[] {
  return variantControls(family, variant).filter((control) => PRICE_KEY_SET.has(control.key));
}

/** Everything at its default, so a combination only differs where it means to. */
export function baseInput(family: Family, variant: Variant): InputMap {
  const input: InputMap = {};
  for (const control of variantControls(family, variant)) input[control.key] = defaultOf(control);
  return input;
}

/** The full cross product of the price-relevant controls. */
export function combosFor(family: Family, variant: Variant): InputMap[] {
  let out: InputMap[] = [baseInput(family, variant)];
  for (const control of priceControls(family, variant)) {
    const values = valuesFor(control);
    out = out.flatMap((input) => values.map((value) => ({ ...input, [control.key]: value })));
  }
  return out;
}

/**
 * The selector for a combination: only the named keys, always in the same order.
 *
 * Key order matters because the selector is a jsonb column under a UNIQUE index.
 * Postgres compares jsonb by value rather than by text, so ordering does not
 * change equality — but it does change what the row looks like to a human
 * reading the table, and a stable order makes the seeder's "did this change?"
 * comparison a plain equality check.
 */
export function selectorFrom(input: InputMap, keys: readonly string[]): Record<string, string> {
  const selector: Record<string, string> = {};
  for (const key of [...keys].sort()) selector[key] = String(input[key]);
  return selector;
}

export function eachVariant(): { family: Family; variant: Variant }[] {
  return FAMILIES.flatMap((family) => family.variants.map((variant) => ({ family, variant })));
}
