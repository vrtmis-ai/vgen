import type { InputMap } from "../../components/controls";
import type { Control } from "../../data/models";

export function currentAspect(controls: Control[], input: InputMap): { w: number; h: number } {
  const aspect = controls.find((control) => control.kind === "aspect");
  if (aspect?.kind === "aspect") {
    const option = aspect.options.find((candidate) => candidate.value === input[aspect.key]) ?? aspect.options[0];
    if (option) return { w: option.w, h: option.h };
  }
  return { w: 16, h: 9 };
}
