---
name: VGen Unified
colors:
  canvas: '#090909'
  surface: '#121212'
  surface-raised: '#191919'
  surface-overlay: '#232323'
  surface-bright: '#353534'
  text: '#f5f3ef'
  text-secondary: '#e5e2e1'
  text-muted: '#a8a29e'
  text-faint: '#6b6663'
  text-on-primary: '#ffffff'
  primary: '#e95f18'
  primary-hover: '#ff7a38'
  primary-press: '#c94e10'
  primary-soft: '#ffb598'
  primary-dim: '#b83f0a'
  accent: '#9dcaff'
  accent-strong: '#1995f1'
  accent-deep: '#002440'
  success: '#4ade80'
  warning: '#fbbf24'
  danger: '#ffb4ab'
  danger-bg: '#93000a'
  info: '#9dcaff'
  border: 'rgba(255,255,255,0.10)'
  border-subtle: 'rgba(255,255,255,0.05)'
  border-strong: 'rgba(255,255,255,0.15)'
typography:
  display:
    fontFamily: Syne
    fontSize: 40px
    fontWeight: '800'
    lineHeight: '1.15'
    letterSpacing: -0.03em
  headline:
    fontFamily: Syne
    fontSize: 28px
    fontWeight: '700'
    lineHeight: '1.25'
    letterSpacing: -0.02em
  title:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.35'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.55'
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1.4'
    letterSpacing: 0.02em
  caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.08em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  page-margin-mobile: 16px
  page-margin-tablet: 24px
  page-margin-desktop: 64px
  gutter: 12px
  container-max: 1440px
  touch-target-min: 44px
  cta-height: 54px
  nav-height: 64px
  sidebar-width: 280px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
  section-gap: 48px
---

## Brand & Style

VGen is a dark-room instrument for AI generation. The aesthetic is **Cinematic
Minimalism**: a near-black environment where generated media is the only bright
thing on screen, punctuated by a single high-energy orange that marks intent.

The narrative is "the void and the spark." The interface should feel like
expensive physical hardware — precise, quiet, intentional — never like a
consumer web app. Depth comes from tonal layering, hairline borders, and
translucency, not from drop shadows. Chrome recedes; content commands.

This system unifies two earlier Stitch systems ("Cinematic Noir" for mobile,
"VGen Cinematic Creative" for desktop). Where they disagreed, the resolution is
recorded in `README.md`.

## Colors

The palette is engineered for a dark room and OLED panels.

- **Canvas `#090909`** is the page. It is nearly true black so media reads as
  emissive.
- **Surface ladder.** Elevation is expressed as lightness, in four discrete
  steps: `#121212` cards and inputs, `#191919` sheets and menus, `#232323`
  active/hover states, `#353534` for the rare highest layer. Do not invent
  intermediate values — if a surface needs to feel higher, move it up a step.
- **Primary orange `#E95F18`** is a scalpel. Reserve it for primary CTAs, the
  active navigation item, progress fills, and focus. It must never fill a large
  background area. On a screen with two orange elements, one of them is wrong.
- **Orange as text.** `#E95F18` on `#090909` fails contrast at body sizes. For
  orange *type* and icons use `primary-soft` `#FFB598`, which passes AA.
- **Borders carry depth.** Every elevated element gets a 1px
  `rgba(255,255,255,0.10)` edge; elements at higher z-index step up to `0.15`.
  This is what produces the "machined" look.

### The accent — orange means act, blue means know

The blue is inherited from the mobile system's `tertiary` ramp. It exists to
solve a real problem: with a single accent, a screen full of model badges,
links and background spinners ends up entirely orange, and the CTA stops being
findable. The accent absorbs everything informational so orange can stay scarce.

- **`accent` `#9DCAFF`** — blue *type* and icons on dark. Passes AA at body
  sizes; this is the default blue.
- **`accent-strong` `#1995F1`** — fills only: selected filter chips, the
  informational rule on a note, blue progress. Pair with `accent-deep`
  `#002440` for text sitting on top of it (4.98:1). Stitch's original
  `#003257` was 4.15:1 and failed AA at chip size — do not restore it. White
  on the blue fill is 3.18:1 and is not an option either.
- **Ambient cast.** Floating chrome may drop a cold shadow
  (`--vg-shadow-ambient`), and informational panels may use `--vg-cool-leak`,
  the blue mirror of the orange light leak.

Use it for: model/capability badges, `BETA` tags, links, info banners,
non-primary selected state, background-task progress, a second data-viz series.

Never for: the primary CTA, destructive actions, or anything that competes with
orange for "the one action on this screen". The two accents must never sit
inside the same button.

## Typography

Three families, one job each. Do not add a fourth.

- **Syne** — display and headlines. Its wide, unconventional letterforms supply
  the editorial, cinematic character. Latin only.
- **Inter** — Latin UI and body copy. Systematic, invisible, does its job.
- **Vazirmatn** — all Persian text, UI and body alike.
- **Geist Mono** — numerals that must not jitter: credit counts, durations,
  dimensions, seeds. Always `font-variant-numeric: tabular-nums` and isolated
  with `direction: ltr` so digits don't reorder inside RTL text.

### Bilingual rules

VGen ships Persian-first with English parity. This is a structural constraint,
not a translation layer.

- Set `dir="rtl" lang="fa"` on `<html>`. The token file switches `--vg-font-ui`
  to Vazirmatn automatically; nothing else should hard-code a font.
- **Persian needs more leading.** Body line-height rises from 1.55 to 1.75 and
  `body-lg` from 1.6 to 1.85 — the script's ascenders and descenders collide at
  Latin defaults.
- **Kill negative tracking in Persian.** Tight letter-spacing breaks the joins
  between letters. `--vg-headline-ls` and `--vg-display-ls` both go to `0`.
- **Syne has no Arabic-script coverage.** Persian headings fall back to
  Vazirmatn Black (900), which carries comparable editorial weight.
- **Use logical properties everywhere** — `inline-start`/`inline-end`,
  `padding-inline`, `border-start-start-radius`. Never `left`/`right`. The
  entire component layer mirrors with no RTL-specific overrides.
- **Gradients are the exception — they have no logical direction.** Any
  `linear-gradient` that runs along the inline axis needs an explicit
  `[dir="rtl"]` variant flipping `to right` → `to left`. This affects the
  slider track and both progress bars. Symmetric gradients (the indeterminate
  bar, the skeleton sweep) do not care.
- **Never mirror a range input with `transform: scaleX(-1)`.** Browsers already
  flip `<input type="range">` under `direction: rtl`; adding a transform flips
  it a second time, so the fill paints on the wrong side of the thumb. Only the
  track gradient needs the RTL override.
- **Switching locale must switch copy, not just direction.** Flipping `dir` on
  a Persian string produces left-aligned Persian, which is not an English UI.
  Every user-visible string needs a real translation — including `placeholder`,
  `aria-label`, `title`, `alt`, and any text generated by JavaScript. Digits
  follow the locale too: Persian UI uses ۰–۹ in prose, but `numeric` values
  (credits, seeds, dimensions) stay Latin in both locales so they stay
  scannable. `preview.html` demonstrates the full swap.

## Layout & Spacing

A 4px base unit. Page margin steps with viewport: **16px** mobile, **24px**
tablet, **64px** desktop, capped at a 1440px container.

- **Mobile** is a 4-column fluid grid with a 12px gutter.
- **Desktop** is 12 columns with a 24px gutter and generous vertical rhythm
  between editorial sections.
- **"Massive vs. minute."** Hero sections and media cards should be expansive;
  control panels and settings should be tightly packed at 8px so they feel
  professional and dense, like a real tool. Never split the difference.
- **Thumb zone.** On mobile, the Create button and navigation live in the bottom
  40% of the screen. Any page with the fixed nav needs bottom padding of
  `nav-height + 24px + safe-area-inset-bottom`.

## Elevation & Depth

1. **Level 0** `#090909` — the canvas.
2. **Level 1** `#121212` — cards, inputs, content blocks.
3. **Level 2** `#191919` — bottom sheets, menus, popovers.
4. **Level 3** `#232323` — active pills, hovered rows.

- **Glass.** Floating chrome (navigation, sticky bars) uses `rgba(18,18,18,0.8)`
  with a 20px backdrop blur, so the content beneath stays legible as context.
- **Light leak.** High-elevation hero cards get a radial orange wash at 10%
  opacity in the leading corner, simulating a soft reflection. Subtle enough
  that you notice it only when it's missing.
- **Glow, not shadow.** The primary button carries `0 0 20px rgba(233,95,24,.2)`
  plus a 1px inner white top highlight — it reads as a lit physical surface.
  Reserve real shadows for sheets and modals that must separate from everything.

## Shapes

"Soft-modern." Standard controls use **8px** to feel precise. Cards, buttons,
and the nav bar use **16px** to stay approachable. Bottom sheets use **24px on
the top corners only**, signalling a drawer pulled from the edge of the device.
Pills are for chips, avatars, and the FAB — never for a primary action, which
would read as consumer rather than professional.

## Motion

One curve: `cubic-bezier(0.32, 0.72, 0, 1)`. Three durations: 120ms for state
changes, 220ms for transitions, 420ms for sheets. Press feedback is
`scale(0.97)` — the interface acknowledges touch physically. All of it collapses
to 1ms under `prefers-reduced-motion`.

## Components

- **Primary CTA** — 54px tall, full-width at the bottom of forms and sheets,
  `#E95F18` fill, white bold label, cinematic glow. One per screen.
- **Secondary / ghost** — `#232323` with a hairline border, or transparent.
  Everything that is not *the* action on this screen.
- **Input fields** — background `#090909` (darker than the surface they sit on,
  so they read as recessed), 1px border, focus transitions the border to orange
  with a 2px outer wash.
- **Bottom sheet** — the primary container for prompting and settings. Always
  includes a 32×4px muted drag handle. Max height 88vh, scrollable, over a
  blurred scrim.
- **Segmented control** — aspect ratio, quality. Horizontally scrollable; the
  active item gets a `#232323` pill and full-strength text. Use it when there
  are three or four options; past that, use the stepped slider.
- **Stepped slider** (`.vg-slider-group`) — for a value that is a short ordered
  list rather than a continuum: video duration, frame rate, quality tier. The
  input runs on *indices*, not the values themselves, so the handle can never
  land on a duration the backend does not offer. Ticks are labelled, because a
  handle that snaps should say so before it is dragged. The current value is
  called out in `primary-soft` at title size — it is what the user is setting.
  Set `aria-valuetext` on every change, or a screen reader announces the raw
  index ("2 of 4") instead of the duration.
- **Chips** — 32px tall, 12px type, `#191919`. Selected state fills orange; the
  `--accent` variant fills blue instead, for filters that are selectable but are
  not the screen's action.
- **Badges** — orange for tier and entitlement (`PRO`), blue for machine facts
  (model name, `BETA`, capability).
- **Note** — informational banner: blue wash, 3px blue inline-start rule, icon.
  Tips and quota explanations. Never for errors, which stay `danger`.
- **Media cards** — edge-to-edge artwork, bottom-up black scrim for legible
  white type, 1.02× scale and brighter border on hover.
- **Bottom navigation** — persistent, glass-morphic, 24px icons, active item in
  `#E95F18`.
- **Progress** — orange for the generation the user is waiting on; blue
  (`--accent`) for background work like uploads and queued jobs.
- **Glass is chrome, not a card.** It only reads as glass when there is
  something behind it to blur: docked headers and navigation that content
  scrolls under, sheets over a scrim, tags over artwork. On a flat canvas it is
  indistinguishable from an opaque panel — use `.vg-card` there instead. Two
  opacity levels: `--vg-glass` `0.80` for docked chrome (text must survive
  whatever scrolls beneath), `--vg-glass-panel` `0.70` for floating panels.
  Above ~0.85 the blur stops being visible at all.
- **Media tags** — the small overlays on artwork (`16:9 · 5s`, `1024×1024`) are
  always technical values, so they carry `direction: ltr; unicode-bidi: isolate`.
  Without it, RTL reorders the segments and `16:9 · 5s` renders as `5s · 16:9`.
- **Loading** — Stitch never designed this state; it is built here. A generating
  tile wears the *same* chrome and aspect ratio as the loaded result, so nothing
  shifts when the render lands: hairline border, `radius-lg`, an orange wash
  breathing up from below (the one place orange may fill an area, under 12%
  opacity), and an indeterminate bar — most generations cannot report a
  percentage. Skeletons sit one surface step above their container so they stay
  visible on a card, and use a travelling light sweep rather than a grey colour
  cycle, which is the wrong register for a near-black UI.
- **Reduced motion** — the duration tokens collapse transitions, but looping
  animations declare their own durations and must be stopped explicitly. Do not
  simply hide a loading animation: fall back to a static state that still reads
  as "in progress", or the user cannot tell the app from frozen.

## Accessibility

- Minimum tap target 44×44px, always.
- Body text is `#E5E2E1` on `#090909` (≈15:1). Muted text `#A8A29E` (≈7:1) is
  the floor — never go below it for content that must be read.
- Never use orange fill with orange text; never signal state by colour alone —
  the selected chip changes fill *and* weight.
- Focus is visible on every interactive element via `--vg-glow-focus`, a
  two-ring outline that stays legible on any surface level.
