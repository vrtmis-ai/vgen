/**
 * Tailwind 4 through PostCSS, replacing the `@tailwindcss/vite` plugin.
 *
 * Nothing else changes: src/index.css keeps its `@import "tailwindcss"`,
 * its `@theme static` block and its `layer(components)` imports. `static` is
 * load-bearing — design tokens are referenced from inline `style={{ var(--…) }}`,
 * which no content scanner can see, so tree-shaking them breaks the theme.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
