# Performance report — deevapp.com

What changed on `perf/core-web-vitals`, what it measured, what did not work,
and what is left, ranked. The starting point is in `PERF_BASELINE.md`.

## How this was measured

Production cannot be measured before a deploy, so every change was compared on
two local production builds side by side: the untouched baseline (`fb6abc7`) on
`:5191` and the branch on `:5192`, both built with production's public env.

The page loads four public API endpoints. From `localhost` those calls fail on
CORS and the app renders its API-failure screen instead of the gate, which made
the first round of local numbers meaningless (they measured an error state).
The fix was a small mock API replaying the recorded production responses, so
both servers render exactly what production renders, with no network noise.

Lighthouse 12.8.2, default mobile (simulated slow 4G, 4× CPU), runs interleaved
before/after so drift on the machine hits both sides equally; medians reported.
DevTools traces at 4× CPU for main-thread work. One browser tab at a time —
an early round of traces was contaminated by other open tabs, caught and
redone.

## Results

### Lighthouse mobile, local rig, medians of 3

| page       | score                   | FCP               | LCP (simulated) | TBT              | CLS               |
| ---------- | ----------------------- | ----------------- | --------------- | ---------------- | ----------------- |
| `/` (gate) | 68 → 75 (but see below) | 1.69 → **0.91 s** | 6.51 → 5.17 s   | 351 → **258 ms** | 0.002 → 0.012     |
| `/signin`  | 56 → **76**             | 1.51 → **0.91 s** | 5.26 → 4.97 s   | 341 → **253 ms** | **0.330 → 0.000** |
| `/about`   | 73 → **81**             | 1.66 → **0.91 s** | 4.81 → 4.21 s   | 306 → 260 ms     | **0.099 → 0.000** |
| `/plans`   | 73 → 74                 | 1.51 → **0.91 s** | 5.56 → 5.32 s   | 300 → 292 ms     | 0.003 → 0.012     |

### Home and sign-in again, medians of 5

Three runs were not enough for home, whose baseline swings by 7 points:

| page             | score (range) | FCP        | LCP (simulated)        | TBT              | CLS       | page's own main-thread work |
| ---------------- | ------------- | ---------- | ---------------------- | ---------------- | --------- | --------------------------- |
| `/` before       | 72 (67–74)    | 1.51 s     | 5.93 s (5.46–6.69)     | 305 ms (260–410) | 0.003     | 2,579–3,273 ms              |
| `/` after        | 72 (72–73)    | **0.91 s** | **5.34 s** (5.33–5.37) | 340 ms (321–373) | 0.012     | **511–651 ms**              |
| `/signin` before | 57            | 1.51 s     | 5.30 s                 | 329 ms           | 0.328     |                             |
| `/signin` after  | **77**        | **0.91 s** | **4.82 s**             | **264 ms**       | **0.000** |                             |

Read honestly: **home's score does not move.** What moves is underneath it —
first paint 40% sooner, simulated LCP 0.6 s lower and no longer swinging by a
second, and the page's own main-thread work down ~80%, which is the gleam. TBT
only counts tasks over 50 ms; the gleam's cost was hundreds of ~5 ms frames, so
removing it frees the main thread without touching TBT, whose median here is
inside the baseline's own spread. Home's score is held by the JavaScript it
loads — the zod item below.

### Measured directly

|                                                    | before                               | after                             |
| -------------------------------------------------- | ------------------------------------ | --------------------------------- |
| JS transferred on `/`, cold                        | 659 KB, 24 scripts                   | **560 KB, 22 scripts** (−15%)     |
| JS decoded on `/`                                  | 2,265 KB                             | 1,961 KB                          |
| PostHog fetched before consent                     | yes                                  | **no**                            |
| Main thread busy while the gate sits idle (4× CPU) | **~645 ms of every second**          | **~77 ms**                        |
| `/signin` layout shift, cold, 4× CPU, slow 4G      | 0.365                                | **0**                             |
| Telegram script on every page                      | 140 KB, layout shift 0.26            | gone                              |
| Font chain before the LCP text can render          | HTML → CSS → font (3.7 s on slow 4G) | HTML → font, in parallel with CSS |

**About LCP.** Observed LCP equals FCP on every page — the cookie notice paints
in the first frame (≈0.15–0.25 s locally). The 4–5 s figures are Lighthouse's
_simulated_ LCP, which treats every script requested before the LCP as able to
delay it and replays those bytes over slow 4G. So on the score, LCP is driven by
how much JavaScript a page asks for early. That is why the zod migration below
is the largest remaining lever.

## What changed, by commit

| commit    | change                                                     | why it was first                                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eb077f3` | Stop loading Telegram's web-app script                     | Nothing read `window.Telegram`. 140 KB from a host filtered in Iran, and its writes to `<html>` caused the 0.26 shift on `/` and `/plans` and the sign-in shift.                                                    |
| `833ec73` | Preload the two Vazirmatn files a Persian first paint uses | Fonts were found only after the 134 KB stylesheet was parsed. Files moved to `public/fonts` under their content-hashed names and served `immutable`. Persian pages only.                                            |
| `883290e` | Download PostHog only after somebody consents              | 95 KB compressed shipped on every route through `CookieConsent`. `import()` on first consent; SDK calls queued on one promise so their order is unchanged.                                                          |
| `4f6306b` | Show the sign-in form on arrival instead of sliding it in  | The step transition ran on first mount: form server-rendered invisible and 60 px aside, revealed after hydration, re-centring the column — 0.36 CLS. `AnimatePresence initial={false}`, as `Generate` already does. |
| `1d1fab2` | Let the gate's bars breathe on the compositor              | `var()` in keyframes forced per-element main-thread work for 15 bars. Height is now a static `scale`, the breath a plain `transform`.                                                                               |
| `19ea1c7` | Turn the gleam's layers instead of repainting its gradient | The invite button animated a registered custom property; the browser restyled and repainted it every frame. Now static gradients on layers that rotate.                                                             |

### How the gleam looks now

The gleam rewrite is identical to the original in English, and in Persian. The
original centred its dots and sheen with `inset-inline-start` plus a physical
`translate`, which on a right-to-left page pushed them off the button, so
Persian visitors have only ever seen the arc. The rewrite centres the layers
correctly, then hides the dots and sheen on right-to-left pages (`:dir(rtl)`)
so that look is kept on purpose rather than by accident.

The hover no longer slows the spin (that relied on `animation-composition: add`,
which is itself one of the reasons an animation cannot be composited); the arc
still widens, warms and swings, the label's bloom still breathes. The button is
2 px narrower, because the 1 px border became a layer.

## What did not work

- **Static rendering.** Every route is dynamic because the root layout reads a
  cookie. Measured cost: origin renders in 10–21 ms and the CDN reaches it in
  27–44 ms. Making routes static would save ~30 ms; not attempted.
- **Keeping the demo adapters out of production** (`13c5dce`, reverted in
  `bd9b262`). The branch folds to `false`, but Turbopack keeps a statically
  imported module it cannot prove side-effect-free, so the 22 KB stayed.
- **`import * as z from "zod"`.** esbuild drops zod from 90 to 27 KB
  compressed with that import style; Turbopack does not prune it at all
  (136 KB either way). Not committed.
- **`three` was never a first-load cost.** The baseline's per-route totals
  include lazily loaded chunks; `GenerationField` already loads it on demand.
  Corrected in the baseline.

## Remaining opportunities, ranked by impact

1. **zod → `zod/mini` in the browser (~100 KB compressed on every route).**
   Classic zod carries a 55 KB JIT that is declared a side effect and JSON-schema
   support built into every schema, so no bundler can drop either while classic
   is used. Mini needs neither. ~1,000 call sites across 31 files — a codemod,
   plus a check that error messages shown to users survive (mini loads no
   locale by default). Its own PR, next.
2. **TTFB from the network (0.4–0.95 s of TLS, 1.1–2.9 s HTML).** Fast TCP to
   the WCDN edge followed by a slow TLS handshake is a middlebox on the path,
   not this codebase. HTTP/3 at the CDN is the only lever; a question for WCDN.
3. **framer-motion (~62 KB compressed, every route).** `LazyMotion` with `m`
   components would load features on demand; 23 importing files.
4. **The demo adapters (22 KB).** Needs an asynchronous runtime resolution or a
   `sideEffects` declaration for the app.
5. **134 KB stylesheet**, render-blocking on every route.
6. **gzip only** at Caddy/CDN; zstd or brotli would shave ~15% off every text
   response, if WCDN passes them through.

## Also found

- The signed-in surfaces (studio, gallery, explore) were not measured
  authenticated. They share every first-load change above.

## Verify after deploy

1. Lighthouse mobile on production for `/`, `/signin`, `/plans`, `/about`,
   3 runs each, against the baseline table.
2. Accept analytics on production and confirm `/ingest` requests appear — the
   lazy PostHog path could not be exercised locally (no project token there).
   Then reload: a returning visitor who already said yes is started by
   `instrumentation-client.ts`, and `/ingest` should fire again without a click.
3. Persian gate: the arc alone turns, no dots. English gate: arc, lit dots and
   sheen. Both: the arc widens on hover.
4. `curl -I https://deevapp.com/fonts/v16-Dxxo8j6PP2D_kU2muijlGMWWMmk.woff2`
   returns `immutable`.
