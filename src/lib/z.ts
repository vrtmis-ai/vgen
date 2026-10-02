/**
 * The part of zod the browser uses, imported by name.
 *
 * `import { z } from "zod"` asks the bundler for zod's whole namespace object.
 * Rollup and webpack narrow that to the members you touch — zod's own
 * `index.js` says so, and says that without the aliasing it does there they
 * would "pull in every locale". Turbopack does not narrow it, and measurably
 * so: it kept all 63 locale modules, the JSON-Schema converters and the 54 KB
 * JIT compiler, 131 KB compressed on every route, for a product that speaks
 * Persian and English and converts no schemas. Named re-exports give it plain
 * bindings to trace instead of a namespace to materialise, and the same
 * bundle holds 35 KB.
 *
 * So this is a bundler workaround, not an abstraction: every call site still
 * writes `z.string().min(1)`, unchanged, and only the import line differs.
 * Need a member that is not here? Add it — the list is short because the
 * browser's schemas are, not because anything is held back.
 *
 * The lint rule in `eslint.config.js` keeps `app/` and `src/` off `"zod"`
 * directly, which is the only thing stopping one new import from quietly
 * putting the 96 KB back. Server code (`apps/`, `packages/`, `scripts/`) is
 * not bundled and imports zod normally.
 */
export {
  array,
  boolean,
  discriminatedUnion,
  enum,
  literal,
  number,
  object,
  record,
  string,
  undefined,
  union,
  unknown,
  url,
  uuid,
} from "zod";

export type { infer, input, ZodType } from "zod";
