# DEEV OTP Authentication and Brand Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Make Clerk email authentication OTP-only and make every customer-facing product name consistently display as DEEV without breaking stable internal identifiers.

**Architecture:** Clerk remains the browser identity provider and its dashboard owns allowed factors. The frontend continues using Clerk's prebuilt sign-in/sign-up flow. Branding stays centralized in `src/data/brand.ts`; package scopes, storage keys, class names, and database identifiers remain unchanged because renaming those is a separate migration.

**Tech Stack:** Clerk, React 18, Vite, Vitest.

---

### Task 1: Configure OTP-only email authentication

**External configuration:** Clerk Dashboard → Configure → User & authentication.

1. Keep email sign-up, required email, verification at sign-up, and email verification code enabled.
2. Keep email verification links disabled.
3. Disable both `Sign-up with password` and `Add password to account`.
4. Save and confirm no unsaved-change banner remains.

### Task 2: Add a failing visible-brand test

**Files:**

- Modify: `src/screens/Landing.test.tsx`

Add an assertion that the landing header renders `DEEV`, then run:

```bash
npm test -- src/screens/Landing.test.tsx
```

Expected before implementation: FAIL because the current brand constant is `VGen`.

### Task 3: Rename customer-facing product text

**Files:**

- Modify: `src/data/brand.ts`
- Modify: `src/lib/i18n.tsx`
- Modify: `src/app/ConfigurationError.tsx`
- Modify: `src/app/runtime.ts`
- Modify: `index.html`
- Modify: `package.json`
- Modify: `README.md`

Set `BRAND.name` and the document title to `DEEV`; replace visible Persian/English sign-in and about labels; update runtime/configuration messages and project description. Do not rename `@vgen/*`, `VgenBrowserRouter`, local-storage keys, database names, or environment-variable names.

Run:

```bash
npm test -- src/screens/Landing.test.tsx src/app/runtime.test.ts
npm run typecheck
```

Expected: PASS.
