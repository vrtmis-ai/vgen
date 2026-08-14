/**
 * Browser-visible configuration. Replaces the Vite `ImportMetaEnv` declaration.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, but only for literal
 * member expressions — `process.env[name]` and object spreads are NOT inlined
 * and read as undefined in the browser. Every read of these must therefore be
 * written out in full.
 *
 * Nothing secret goes here. `NEXT_PUBLIC_` is the browser bundle: a key added to
 * this list is a key served to every visitor.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly NEXT_PUBLIC_APP_MODE?: "demo" | "production";
    readonly NEXT_PUBLIC_API_BASE_URL?: string;
    readonly NEXT_PUBLIC_APP_RELEASE?: string;
  }
}
