import type { NextConfig } from "next";

/**
 * Deployed to a Node server / VPS, not a serverless platform.
 *
 * `standalone` emits a self-contained server bundle with its own pruned
 * node_modules, which is what makes this deployable behind an Iranian CDN
 * without shipping the whole pnpm store. It replaces the old GitHub Pages
 * static export — that deploy served the app from a `/vgen/` sub-path, which is
 * why `basePath` is absent here: this now serves from the domain root.
 *
 * The API stays a separate Fastify process (apps/api). Nothing in this app
 * talks to Postgres directly, so no database configuration belongs in here.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  /**
   * The standalone tracer under-copies one package, and it is fatal.
   *
   * `next/dist/server/require-hook.js` is the first thing the emitted server.js
   * loads, and it resolves `@swc/helpers` through that package's `exports` map
   * to the ESM build. The tracer copies only `cjs/` and `package.json`, so the
   * bundle contains a real `@swc/helpers` directory that cannot answer the one
   * request made of it. The image builds green and the container then
   * restart-loops on MODULE_NOT_FOUND naming a file inside a package it has.
   *
   * The glob goes through `.pnpm` deliberately: this is a pnpm workspace, the
   * package is a transitive dependency of `next`, and it is not hoisted to a
   * top-level `node_modules/@swc` in either layout.
   */
  outputFileTracingIncludes: {
    "/**": ["./node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*"],
  },
  /**
   * Dev-only. Next 16 answers 403 to any `/_next/*` request carrying an Origin
   * it does not recognise, and the default allowlist covers `localhost` but not
   * `127.0.0.1` — which is what Playwright's baseURL, `.env.e2e` and WEB_ORIGIN
   * all use. The symptom is not obvious: the document renders (it carries no
   * Origin), then every chunk 403s, so the page sits on its server-rendered
   * loading state forever with no error in the server log.
   */
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
