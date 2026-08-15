# DEEV Wallet and Signup Gift Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task.

**Goal:** Give every newly-created internal customer exactly one 12-credit, 14-day signup gift and return their real spendable wallet from the API.

**Architecture:** User creation and initial gift creation happen inside one PostgreSQL transaction. The append-only ledger records the matching credit event with a stable idempotency key. A dedicated wallet repository owns read projection and the HTTP route depends on a wallet application port instead of SQL.

**Tech Stack:** PostgreSQL, postgres.js, Fastify, Zod, Vitest.

---

### Task 1: Specify idempotent signup gift behavior

**Files:**

- Modify: `packages/db/src/identityRepository.integration.test.ts`

Add an integration test that syncs the same Clerk user twice and asserts one `credit_grants` row, one `credit_ledger` row, amount `12`, consumed `0`, reason `grant_signup_gift`, idempotency key `signup_gift:v1`, and an expiry approximately 14 days after grant time.

Run:

```bash
pnpm --filter @vgen/db test:integration -- identityRepository.integration.test.ts
```

Expected before implementation: FAIL because no grant exists.

### Task 2: Create the initial grant atomically

**Files:**

- Modify: `packages/db/src/identityRepository.ts`

Export `SIGNUP_GIFT_COINS = 12` and `SIGNUP_GIFT_TTL_DAYS = 14`. Immediately after inserting a new `users` row and Clerk identity, insert one `signup_gift` grant and its ledger entry in the same transaction. Repeated syncs must not create another gift.

Run the integration test again; expected PASS.

### Task 3: Implement the wallet read model

**Files:**

- Create: `packages/db/src/walletRepository.ts`
- Create: `packages/db/src/walletRepository.integration.test.ts`
- Modify: `packages/db/src/index.ts`

Define a `CustomerWallet` DTO and `CustomerWalletRepository`. Query only grants with remaining credits and no expiry or a future expiry, sort expiring grants first, map database kinds to the public grant kinds, sum `amount - consumed`, and calculate `nextExpiry` from the first expiring grant. Convert bigint amounts safely to integer numbers and timestamps to epoch milliseconds.

Test expired-grant exclusion, remaining-balance calculation, ordering, and next expiry.

### Task 4: Wire the wallet port into Fastify

**Files:**

- Modify: `apps/api/src/routes/wallet.ts`
- Modify: `apps/api/src/createApp.ts`
- Modify: `apps/api/src/createApp.test.ts`
- Modify: `apps/api/src/server.ts`

Add `CustomerWalletApplication.getCurrent(userId)` to API dependencies, delegate authenticated wallet requests to it, retain the anonymous 401 response, and construct `PostgresWalletRepository(sql)` in the server.

Run:

```bash
pnpm --filter @vgen/api test
pnpm --filter "@vgen/*" typecheck
```

Expected: PASS.
