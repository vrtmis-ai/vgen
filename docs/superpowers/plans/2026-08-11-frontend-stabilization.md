# Vgen Frontend Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current UI prototype into a tested frontend that consumes explicit application ports and no longer treats demo state as production state.

**Architecture:** Keep React/Vite and introduce feature-oriented application boundaries: session, catalog, wallet, generation, and gallery. Screens consume typed hooks; adapters provide either HTTP or explicit demo implementations selected by environment. Browser navigation becomes URL-backed and persisted data is schema-validated.

**Tech Stack:** React 18, Vite 6, TypeScript strict mode, React Router, Zod, TanStack Query, Vitest, Testing Library, Playwright, ESLint, Prettier.

---

### Task 1: Establish the quality gate

**Files:**
- Modify: `package.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] Install `vitest`, `jsdom`, Testing Library, ESLint, Prettier, React Router, Zod and TanStack Query as pinned dependencies.
- [ ] Add scripts `lint`, `format:check`, `test`, `test:watch`, `test:e2e`, and redefine `check` as typecheck + lint + unit tests + catalog checks.
- [ ] Configure Vitest with jsdom and `src/test/setup.ts`.
- [ ] Add one smoke test that renders the root with injected demo adapters.
- [ ] Run `npm.cmd run check`; expect every command to exit 0.

### Task 2: Create typed frontend ports

**Files:**
- Create: `src/app/contracts/session.ts`
- Create: `src/app/contracts/catalog.ts`
- Create: `src/app/contracts/wallet.ts`
- Create: `src/app/contracts/generation.ts`
- Create: `src/app/contracts/gallery.ts`
- Create: `src/app/AppServices.tsx`
- Test: `src/app/AppServices.test.tsx`

- [ ] Define result DTOs as Zod schemas and infer TypeScript types from those schemas.
- [ ] Define service interfaces for `getSession`, `listCatalog`, `getWallet`, `quoteGeneration`, `createGeneration`, `getJob`, and `listGenerations`.
- [ ] Add an `AppServicesProvider` that throws a descriptive error when used without adapters.
- [ ] Test missing-provider failure and injected-adapter success.

### Task 3: Isolate demo behavior

**Files:**
- Create: `src/adapters/demo/session.ts`
- Create: `src/adapters/demo/wallet.ts`
- Create: `src/adapters/demo/generation.ts`
- Create: `src/adapters/demo/index.ts`
- Modify: `src/lib/session.ts`
- Modify: `src/App.tsx`
- Test: `src/adapters/demo/generation.test.ts`

- [ ] Move `DEMO_SIGNED_IN`, `DEMO_USER`, demo wallet and random progress simulation under `src/adapters/demo`.
- [ ] Require `VITE_APP_MODE=demo` to activate demo adapters; fail visibly if production mode lacks an API base URL.
- [ ] Ensure production code contains no unconditional authenticated user.
- [ ] Test deterministic demo job progression with fake timers rather than `Math.random()`.

### Task 4: Replace memory navigation with routes

**Files:**
- Create: `src/app/router.tsx`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Test: `src/app/router.test.tsx`

- [ ] Map tabs and flows to stable routes: `/`, `/studio/:kind`, `/explore`, `/effects`, `/academy`, `/mcp`, `/community`, `/gallery`, `/plans`, `/profile`, `/generate/:familyId`, `/result/:generationId`.
- [ ] Replace `stackRef`, `pushState`, and manual `popstate` handling with router navigation.
- [ ] Preserve prompt and variant in validated search parameters only when safe to expose.
- [ ] Test direct load, browser back, browser forward and unknown model/result routes.

### Task 5: Validate persisted browser data

**Files:**
- Create: `src/adapters/browser/storage.ts`
- Modify: `src/lib/gallery.ts`
- Modify: `src/lib/favorites.ts`
- Modify: `src/components/ViewControls.tsx`
- Modify: `src/lib/i18n.tsx`
- Test: `src/adapters/browser/storage.test.ts`

- [ ] Add versioned Zod schemas for gallery, favorites, language and view preferences.
- [ ] Discard only invalid records rather than the entire valid collection.
- [ ] Never convert `running` to `done` on reload; demo mode may reconcile through its adapter.
- [ ] Add migrations for the current unversioned storage keys.
- [ ] Test corrupted JSON, old schemas, missing fields, invalid enums and quota errors.

### Task 6: Introduce server-driven queries and mutations

**Files:**
- Create: `src/adapters/http/client.ts`
- Create: `src/adapters/http/session.ts`
- Create: `src/adapters/http/catalog.ts`
- Create: `src/adapters/http/wallet.ts`
- Create: `src/adapters/http/generation.ts`
- Create: `src/features/session/useSession.ts`
- Create: `src/features/generation/useGeneration.ts`
- Modify: `src/App.tsx`
- Test: `src/adapters/http/client.test.ts`

- [ ] Add a fetch wrapper that parses JSON through schemas and maps every error to `{ code, message, requestId, status }`.
- [ ] Send credentials as secure cookies; never persist bearer tokens in localStorage.
- [ ] Use TanStack Query for session/catalog/wallet and mutations for quote/create.
- [ ] Poll only queued/running jobs and stop on terminal states.
- [ ] Test abort, timeout, malformed response, 401, 409 idempotency conflict and 429 retry metadata.

### Task 7: Make generation controls honest

**Files:**
- Modify: `src/lib/useCreateState.ts`
- Modify: `src/screens/Generate.tsx`
- Modify: `src/components/FormPanel.tsx`
- Create: `src/features/generation/validation.ts`
- Test: `src/features/generation/validation.test.ts`

- [ ] Validate prompts, control values, required references, MIME, size and duration before quote/create.
- [ ] Treat the server quote as authoritative and display a quote expiry.
- [ ] Send an idempotency key with create requests and disable duplicate submission while pending.
- [ ] Display structured insufficient-balance, locked-model, unsupported-combination and provider-unavailable errors.
- [ ] Test family/variant changes reset incompatible fields and never submit stale references.

### Task 8: Fix popover and dialog accessibility

**Files:**
- Create: `src/components/FloatingSurface.tsx`
- Modify: `src/components/Popover.tsx`
- Modify: `src/components/ModelPicker.tsx`
- Modify: `src/components/PresetPicker.tsx`
- Modify: `src/components/VoicePicker.tsx`
- Modify: `src/components/AssetViewer.tsx`
- Test: `src/components/Popover.test.tsx`

- [ ] Centralize portal positioning and update it on scroll, resize and visual viewport changes.
- [ ] Implement focus entry/return, Escape, click-away, Arrow keys, Home/End and selected option announcement.
- [ ] Add dialog semantics, focus trapping and background inertness to modal viewers.
- [ ] Test keyboard-only operation in LTR and RTL.

### Task 9: Add observability and end-to-end coverage

**Files:**
- Create: `src/app/telemetry.ts`
- Modify: `src/components/ErrorBoundary.tsx`
- Create: `playwright.config.ts`
- Create: `e2e/auth.spec.ts`
- Create: `e2e/generation.spec.ts`
- Create: `e2e/navigation.spec.ts`

- [ ] Report sanitized crashes with release, host, route and request ID.
- [ ] Add user-facing retry states for network failures without exposing raw exception messages.
- [ ] Cover anonymous redirect, authenticated load, quote/create, job completion, insufficient funds and browser navigation.
- [ ] Run `npm.cmd run check` and `npm.cmd run test:e2e`; expect zero failures.

