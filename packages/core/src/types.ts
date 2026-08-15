/** A control's value, as the user set it. Mirrors src/components/controls. */
export type InputValue = string | number | boolean;
export type InputMap = Record<string, InputValue>;

/**
 * Everything a rate function needs that isn't one of the user's settings.
 *
 * These two used to share a single `chars` argument, which forced the caller to
 * guess which meaning a model wanted and pass the other as a stand-in. It
 * guessed wrong: with no clip attached, Generate passed the prompt's length, so
 * Motion Control — billed per second — quoted 27 credits per character typed.
 * Two fields, no guessing.
 */
export interface PriceCtx {
  /** Prompt length. Only the per-1000-character speech models read this. */
  chars: number;
  /**
   * Whole seconds of the attached source clip, or 0 when there is none and when
   * its duration could not be read. Already ceiled by the caller — KIE bills
   * whole seconds — and clamped to the slot's documented window.
   */
  clipSeconds: number;
}

/** null = the provider has no such offering, so the combination can't be sold. */
export type RateFn = (i: InputMap, c: PriceCtx) => number | null;
