/**
 * The part of zod these contracts use, imported by name.
 *
 * This package looks like server code and is not: `@vgen/core` imports it, the
 * web app imports `@vgen/core`, so every schema here reaches the browser.
 * `import { z } from "zod"` asks the bundler for zod's whole namespace object,
 * and Turbopack — unlike Rollup and webpack, which zod's own `index.js` says
 * narrow it — keeps all of it: 63 locale modules, the JSON-Schema converters
 * and a 54 KB JIT compiler. Named re-exports give it plain bindings to trace.
 *
 * A bundler workaround, not an abstraction: call sites still write
 * `z.string().min(1)`, and only the import line differs. See `src/lib/z.ts` in
 * the web app, which does the same for its own schemas, and the lint rule in
 * `eslint.config.js` that keeps both honest.
 */
export { array, boolean, coerce, discriminatedUnion, enum, literal, number, object, record, string, union, unknown, url, uuid } from "zod";

export type { infer } from "zod";
