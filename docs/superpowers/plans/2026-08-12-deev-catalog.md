# DEEV Published Catalog Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Replace the empty bootstrap catalog API with a validated, published catalog snapshot backed by PostgreSQL, and provide a repeatable seed/publish command for the current DEEV model catalog.

**Architecture:** Each catalog version stores one active `models` row per family. The full validated frontend `Family` payload lives in `models.spec`; normalized columns support filtering and future admin controls. The latest non-null `published_at` version is the only customer-visible snapshot. A seed command publishes all current `FAMILIES` in one transaction.

**Tech Stack:** PostgreSQL, postgres.js, Fastify, Zod, tsx, Vitest.

---

### Task 1: Specify latest-published snapshot reads

**Files:**

- Create: `packages/db/src/catalogRepository.integration.test.ts`
- Create: `packages/db/src/catalogRepository.ts`
- Modify: `packages/db/src/index.ts`

Test that no published version returns the bootstrap snapshot, drafts are ignored, the latest published version wins, inactive rows are excluded, and families are returned in stable insertion/key order. Validate every stored `spec` with the catalog contract before returning it.

### Task 2: Wire catalog application dependency

**Files:**

- Modify: `apps/api/src/routes/catalog.ts`
- Modify: `apps/api/src/createApp.ts`
- Modify: `apps/api/src/createApp.test.ts`
- Modify: `apps/api/src/server.ts`

Add a `CustomerCatalogApplication.list()` port, delegate `/api/v1/catalog` to it, and construct `PostgresCatalogRepository(sql)` in production. Unit tests use a fake snapshot and assert the route forwards it unchanged.

### Task 3: Add a transactional catalog publisher

**Files:**

- Create: `scripts/publish-catalog.ts`
- Modify: `package.json`

Load root environment files, validate `FAMILIES` using `CatalogSnapshotSchema`, start a transaction, insert a draft `catalog_versions` row, insert one model row per family using `family.id`, `family.kind`, `minTierFor(family.id)`, `family.maxPrompt`, `family.noPrompt`, and the full family as `spec`, then set `published_at = now()` only after all rows succeed. Add `catalog:publish` script.

Run:

```bash
npm run catalog:publish
pnpm --filter @vgen/db test:integration
pnpm --filter @vgen/api test
npm test -- src/app/contracts/contracts.test.ts
```

Expected: API returns the published DEEV families and frontend parsing succeeds.

### Task 4: End-to-end verification

Run:

```bash
npm run typecheck
npm run lint
npm test
pnpm --filter "@vgen/*" typecheck
pnpm --filter "@vgen/*" test
npm run build
```

Open the local website, verify DEEV branding, authenticated 12-credit wallet, non-empty Explore catalog, and absence of console errors.
