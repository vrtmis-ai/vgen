# Integration

Wiring this design system into the VGen codebase. Pick the section that matches
the stack; the first one applies to everything.

## 1. The universal path (any web stack)

`tokens.css` and `components.css` are plain CSS. No build step, no framework,
no dependency. Copy the `design-system/` folder into the project — `src/styles/`
or `assets/` is conventional — and import in this order:

```css
@import './design-system/tokens.css';      /* must come first */
/* ...your framework's base/reset, Tailwind, etc... */
@import './design-system/components.css';  /* must come last  */
```

Order is not cosmetic. `tokens.css` defines the variables that everything else
resolves against, and `components.css` is written to sit on top of a reset
without `!important`.

Then set the document language on the root element:

```html
<html class="dark" dir="rtl" lang="fa">
```

Fonts — Syne, Inter, Vazirmatn, Material Symbols:

```html
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Syne:wght@400;700;800&family=Vazirmatn:wght@400;500;700;900&family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap">
```

For production, self-host instead. Vazirmatn in particular is large, and the
Persian UI blocks on it:

```bash
npm i @fontsource-variable/vazirmatn @fontsource-variable/inter @fontsource/syne
```

## 2. Tailwind

Optional and additive — the component classes work without it. If the project
already uses Tailwind, merge `tailwind.config.js`:

```js
// tailwind.config.js
const vgen = require('./design-system/tailwind.config.js');

module.exports = {
  content: ['./src/**/*.{ts,tsx,js,jsx,vue,html}'],
  darkMode: 'class',
  theme: { extend: { ...vgen.theme.extend } },
};
```

Every entry maps to a `var(--vg-*)`, so the values are never duplicated. Change
a token in `tokens.css` and both the utilities and the component classes follow.

Tailwind v4 users: the config file is still read via `@config`, or the tokens
can be lifted into `@theme` — they are already CSS custom properties, so it is
a mechanical move.

## 3. React / Next.js

Import once in the root layout, then never think about it again:

```tsx
// app/layout.tsx
import './design-system/tokens.css';
import './design-system/components.css';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html className="dark" dir="rtl" lang="fa">
      <body>{children}</body>
    </html>
  );
}
```

For a locale-aware app, drive both attributes from the route:

```tsx
const dir = locale === 'fa' ? 'rtl' : 'ltr';
return <html className="dark" dir={dir} lang={locale}>…</html>;
```

Nothing else changes between locales. Fonts, line-heights, letter-spacing and
every component's mirroring key off `dir`/`lang` in `tokens.css`.

## 4. Vue / Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  css: ['~/design-system/tokens.css', '~/design-system/components.css'],
  app: { head: { htmlAttrs: { class: 'dark', dir: 'rtl', lang: 'fa' } } },
});
```

## 5. React Native / Expo

CSS custom properties do not exist here, so the tokens need a JS mirror.
Generate it from `tokens.css` rather than hand-copying — hand-copies drift:

```js
// scripts/tokens-to-js.mjs — run whenever tokens.css changes
import { readFileSync, writeFileSync } from 'node:fs';

const css = readFileSync('design-system/tokens.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // strip comments, or a commented-out
                                       // token is emitted as if it were real
const out = {};
for (const [, name, value] of css.matchAll(/--vg-([\w-]+)\s*:\s*([^;]+);/g)) {
  out[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] =
    value.trim().replace(/\s+/g, ' ');   // collapse multi-line values
}
writeFileSync('src/tokens.js', `export default ${JSON.stringify(out, null, 2)};\n`);
```

That yields 112 tokens from the current file.

Caveats that will bite otherwise:

- **Ten tokens reference other tokens** via `var()` — `info`, `border-primary`,
  `font-ui`, the four glows, `shadow-ambient`, and the two leaks. React Native
  cannot parse them; flatten those to literals in the generated file, or skip
  them (the glows and leaks have no RN equivalent anyway).
- RTL is `I18nManager.forceRTL(true)` plus an app reload — it is not a live
  toggle. Use `start`/`end` instead of `left`/`right` in styles, which is the
  direct analogue of the logical properties used here.
- `backdrop-filter` has no equivalent; use `expo-blur` for the glass surfaces.

## 6. Verifying the wiring

Fastest check that tokens are actually live — in the browser console:

```js
getComputedStyle(document.documentElement).getPropertyValue('--vg-primary')
// → "#E95F18"
```

Empty string means `tokens.css` did not load, or loaded after something that
already needed it.

Then compare a real screen against `preview.html` side by side, in both
languages. Everything in the preview is verified; anything that differs in the
app is a migration defect, not a design question.

## 7. Migration order

Convert in this order — it surfaces the expensive problems first, while they
are still cheap to fix:

1. **Primary CTA** — on every screen; proves the token layer and the glow.
2. **Bottom navigation** — proves glass, active state, and safe-area insets.
3. **Inputs and the prompt textarea** — proves focus states and RTL text entry.
4. **Cards and media** — proves the surface ladder and the scrim.
5. **Bottom sheets** — proves motion, scrim, and reduced-motion.

Delete the values you replace as you go. Leaving both a hex and a token
describing the same colour is worse than either alone.
