# Performance baseline — deevapp.com

Measured 2026-10-01 → 02, against production at `6eed15d` and a local
production build of the same commit. Nothing was changed before measuring.

Targets: LCP < 2.5 s, INP < 200 ms, CLS < 0.1, Lighthouse mobile ≥ 90.

## Stack

- **Next.js 16.3.5, App Router** (`app/`, route groups `(app)`, `(auth)`), React
  19.3, Turbopack, `output: "standalone"`, self-hosted on a VPS behind Caddy.
- **WCDN 3.9.6** (an Iranian CDN) in front of Caddy. `deevapp.com` resolves to
  the CDN (`185.239.1.100`), not the server.
- 25 routes, 48 `"use client"` modules. No middleware/proxy file.
- Client libraries of note: `framer-motion` *and* `motion`, `three`, `zod` 4,
  `posthog-js`, `@tanstack/react-query`, `@phosphor-icons/react`,
  `lucide-react`, three `@fontsource-variable` families plus local Vazirmatn.

## 1. Route table (`next build`)

**Every route is `ƒ` dynamic**, including `/about`, `/privacy`, `/terms`,
`/cookies`, `/contact`. Cause: `app/layout.tsx` awaits `cookies()` for the
language and the consent state, which opts the whole tree into dynamic
rendering. (Next 16 no longer prints First Load JS in this table; per-route JS
is in §2.)

**This costs almost nothing today**, measured:

| | |
|---|---|
| Origin render time, every route, from the box | **10–21 ms** |
| CDN → origin for HTML (`wcdn-hosting-waiting-duration`) | **27–44 ms** |
| CDN cache status, HTML | `NFC` (not cached — `no-store`) |
| CDN cache status, `/_next/static/*` | `Miss` then `Hit` |

So making routes static would save ~30 ms of TTFB. Not worth a refactor.

## 2. Client JavaScript (`next experimental-analyze --output`)

`@next/bundle-analyzer` is webpack-only; the docs' tool for Turbopack is
`next experimental-analyze`. Its data was read with a small parser (sizes are
the analyzer's own `size` / `compressed_size`).

Whole app: 24 client JS files, **2,374 KB raw / 817 KB compressed**, CSS 134 KB.

### Ten largest client chunks

| raw KB | compressed KB | contents |
|---:|---:|---|
| 488 | 141 | next 428, app `src/` 60 |
| 381 | 131 | **zod 381** |
| 293 | 95 | **posthog-js 291** |
| 223 | 74 | next |
| 151 | 60 | next |
| 130 | 62 | motion-dom 96, framer-motion 31 |
| 120 | 32 | app `src/` |
| 110 | 39 | next |
| 61 | 26 | app `src/` 40, @phosphor-icons/react 17 |
| 57 | 18 | app `src/` 55 |

### By package (raw KB, all client chunks)

next 983 · app `src/` 409 · **zod 381** · **posthog-js 291** · motion-dom 98 ·
@phosphor-icons/react 67 · framer-motion 50 · @tanstack/query-core 37 ·
tailwind-merge 27. Plus **three 513** on the routes that use it.

### Per route (raw / compressed KB)

| route | raw | compressed | largest |
|---|---:|---:|---|
| /studio/video, /studio/image, /studio/audio, /generate/[id], /gallery | ~3,000 | **~1,000** | next, **three 513**, src, zod |
| /explore, /academy, /community, /mcp, /effects, /result, /plans, /profile | ~2,420 | ~830 | next, src, zod, posthog |
| /signin, /signup, /forgot, /reset | 2,195 | 748 | |
| /admin | 2,185 | 719 | |
| /about, /coins, /contact, /cookies, /privacy, /terms, / (gate) | 2,014 | **665** | |

### Why each heavy package is there

- **zod (131 KB compressed, every route):** the browser's own response
  contracts (`src/runtime/contracts/*`, 46 importing files). The bundle is zod 4
  "classic" whole: JIT compiler 54 KB, JSON-Schema conversion both ways 34 KB
  (unused), locales. The chaining API cannot tree-shake.
- **posthog-js (95 KB, every route):** statically imported by
  `src/lib/analytics.ts`, which `CookieConsent` (root layout) imports — so it
  ships to visitors who have not consented and may never.
- **three (513 KB raw):** only `src/components/ui/quantum-nebula.tsx`, a
  decorative background mounted by `GenerationField`.
- **Demo services (~22 KB compressed):** `runtime.ts` imports
  `createDemoServices` statically; the `APP_MODE` check sits behind a function
  argument, so the bundler cannot drop it. Drags in two JSON snapshots.

## 3. Lighthouse (production, 3 runs each, medians)

Lighthouse 12.8.2, run from a machine in Iran on a domestic connection — the
path real users take. Default mobile (simulated slow 4G, 4× CPU) and desktop.

| page | mobile score | FCP | LCP | TBT | CLS | desktop score | desktop LCP | desktop CLS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/` (invite gate) | **58** | 2.72 s | **4.38 s** | 486 ms | 0.012 | 84 | 0.70 s | **0.266** |
| `/signin` | 70 | 1.50 s | 1.66 s | 458 ms | **0.322** | 95 | 0.87 s | 0.000 |
| `/plans` | 84 | 1.51 s | 2.36 s | 386 ms | 0.075 | 83 | 0.77 s | **0.267** |
| `/about` | 90 | 1.57 s | 2.02 s | 382 ms | 0.058 | 99 | 0.74 s | 0.002 |

Signed-in surfaces (studio, gallery, explore) could not be measured
authenticated; they are the heaviest routes by bundle (§2).

**Field data:** none. CrUX has no record for this origin, and PageSpeed
Insights runs from outside Iran.

## 4. What the traces show

### LCP: the cookie notice, waiting on fonts

For every first-time visitor the LCP element is the consent banner's paragraph
(`CookieConsent.tsx:61`). It is server-rendered and not animated; its delay is
the critical chain (DevTools, slow 4G, 4× CPU, cold cache):

```
HTML                                   done   703 ms
└─ 2n9nfxv1w49ej.css  134 KB, blocking done 1,737 ms
   ├─ Vazirmatn arabic .woff2  45 KB   done 3,705 ms   ← longest chain
   └─ Vazirmatn latin  .woff2  34 KB   done 3,461 ms
```

Fonts are `font-display: swap` and **never preloaded**, so they cannot be
discovered until the stylesheet is parsed. Lighthouse's LCP breakdown: TTFB
0.9–1.1 s, **render delay 3.3–5.3 s**.

### CLS

| culprit | shift | where |
|---|---:|---|
| `telegram-web-app.js` writing `--tg-viewport-*` onto `<html>` | **0.261** | home, plans (desktop) |
| centred auth container `main > div.flex-1.justify-center` | **0.306** | signin (mobile) |
| Vazirmatn swap | ≤0.004 | all |

**Nothing in the app reads `window.Telegram` or any `--tg-*` variable.** The
script is 140.5 KB transferred, from a host filtered in Iran, and also has a
`preconnect` in the head.

### Main thread: a button that never stops repainting

Mobile Lighthouse attributes **2.6–2.9 s to Style & Layout** — more than script
evaluation (0.9–1.3 s). Traces show style recalculation ~120×/s for as long as
the page is open. Bisected on the live page, same session:

| | style recalc | paint |
|---|---|---|
| gleam animation on | 104/s, **565 ms/s** | 206/s, **119 ms/s** |
| gleam animation fully off | 42/s, 93 ms/s | 19/s, 3 ms/s |

The `.vg-gleam` invite button animates a conic-gradient through `@property`
angles. That cannot run on the compositor (trace: `Animation
{compositeFailed: 80}`), so it costs ~590 ms of every second on a throttled
phone. The remaining 93 ms/s is likely `vg-bar-breathe`, whose keyframes use
`var()`.

### Smaller findings

- Legacy JavaScript: ~22 KB of polyfills/transforms flagged.
- Unused JS on the gate: 83 + 70 + 67 + 37 KB across the four biggest chunks.
- A `Link: </>; rel=preconnect` response header preconnects to nothing.

## 5. Network and caching

| | |
|---|---|
| TCP connect to the CDN edge | 6–30 ms |
| TLS handshake after that | **0.4–0.95 s** |
| HTML TTFB end to end | **1.1–2.9 s** (one 10.6 s outlier) |
| Compression | gzip only, no brotli/zstd |
| `/_next/static/*` | `public, max-age=31536000, immutable`, CDN-cached |
| HTML | `private, no-cache, no-store` |

Fast TCP followed by a slow TLS handshake is the signature of a middlebox on
the path. With the CDN spending ~30 ms and origin ~15 ms, **the TTFB is the
network between the user and the edge, and no change in this codebase moves
it.** HTTP/3 at the CDN is the only lever there, and it is an infrastructure
question.

## Raw data

Kept outside the repo (scratchpad): `build-baseline.log`, analyzer output and
`analyze-baseline.json`, 24 Lighthouse JSON reports, DevTools traces
`trace-home-mobile-*.json.gz` and the bisection traces `ab-*.json.gz`.
