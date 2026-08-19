/**
 * How one provider's parameter names differ from another's.
 *
 * This exists because routing a model to a second provider is useless without
 * it. `model_routes` lets an admin say "Seedream runs on WaveSpeed now", but
 * the job's params were built for KIE — KIE takes `aspect_ratio`, WaveSpeed
 * takes `size`, and sending the wrong one means the provider rejects the
 * request, the job fails, and the customer is refunded for a switch that looked
 * like it worked. So the translation has to exist, and it has to be *rows*:
 * putting it in code would mean a deploy for every model that moves, which is
 * the exact thing the routing table was built to avoid.
 *
 * Four operations, applied in this order, and the order matters:
 *
 *   1. `rename` — move a value to the key this provider wants. First, so
 *      everything after it speaks the destination vocabulary.
 *   2. `map`    — translate the value itself. Renaming alone is not enough and
 *      the catalogue proves it: KIE takes `aspect_ratio: "16:9"` where
 *      WaveSpeed's qwen-image takes `size: "1344*768"`. Same concept, same
 *      customer choice, different alphabet — and a route that moved the key
 *      without translating the value would send "16:9" to a field that parses
 *      `width*height` and fail every generation.
 *   3. `set`    — add or force a value the provider needs.
 *   4. `drop`   — remove what it rejects. Last, so dropping a renamed key
 *      works and a rename into a dropped key is not silently resurrected.
 *
 * Deliberately not an expression language. A mapping rich enough to compute is
 * one where a typo in a jsonb column silently changes what a customer is sent
 * to a provider, and there is no test that would catch it. Anything a provider
 * needs beyond these three belongs in its adapter, where it can be read.
 */

export interface ParamOverrides {
  /** `{ from: to }` — the value moves, the old key goes. */
  rename?: Record<string, string> | undefined;
  /**
   * `{ key: { fromValue: toValue } }`, keyed by the name *after* renaming.
   * A value with no entry is passed through untouched, so a partial table is a
   * partial translation rather than a hole.
   */
  map?: Record<string, Record<string, string>> | undefined;
  /** Applied over whatever is there, so it wins on a collision. */
  set?: Record<string, unknown> | undefined;
  /** Removed last, so a key renamed into and then dropped stays dropped. */
  drop?: string[] | undefined;
}

/** True for the empty case, which is the common one — most jobs have no route. */
export function isEmptyOverrides(overrides: ParamOverrides | null | undefined): boolean {
  if (!overrides) return true;
  return !overrides.rename && !overrides.map && !overrides.set && !overrides.drop;
}

export function applyParamOverrides<T extends Record<string, unknown>>(params: T, overrides: ParamOverrides | null | undefined): T {
  // Returned unchanged rather than shallow-copied: with no route there is
  // nothing to translate, and this is the path every job on its own provider
  // takes.
  if (isEmptyOverrides(overrides)) return params;

  const result: Record<string, unknown> = { ...params };

  for (const [from, to] of Object.entries(overrides?.rename ?? {})) {
    // A rename of a key that is not there is not an error. Params are built
    // from the controls the customer actually touched, so an optional control
    // left alone simply has nothing to move.
    if (!(from in result)) continue;
    result[to] = result[from];
    // Guarded because renaming a key onto itself would otherwise delete it.
    if (from !== to) delete result[from];
  }

  for (const [key, table] of Object.entries(overrides?.map ?? {})) {
    const current = result[key];
    // Only strings and numbers are translated, and the lookup is on the string
    // form. Params reach here from catalogue controls, which produce exactly
    // those, and translating an object would be guessing at what a table meant.
    if (typeof current !== "string" && typeof current !== "number") continue;
    const replacement = table[String(current)];
    if (replacement !== undefined) result[key] = replacement;
  }

  Object.assign(result, overrides?.set ?? {});

  for (const key of overrides?.drop ?? []) delete result[key];

  return result as T;
}
