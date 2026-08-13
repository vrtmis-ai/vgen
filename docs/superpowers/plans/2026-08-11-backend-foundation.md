# Vgen Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the modular monolith that owns identity, catalog, pricing, wallet, generation jobs, media and payments.

**Architecture:** Create a TypeScript workspace with one API process and one worker process sharing a dependency-inverted application core. PostgreSQL is authoritative; Redis/BullMQ only transports work. Credit reservation and job creation occur in one database transaction, and all external calls use ports/adapters plus an outbox.

**Tech Stack:** Node 20+, TypeScript, Fastify, Zod, PostgreSQL, Drizzle ORM, Redis, BullMQ, S3-compatible storage, Vitest, Testcontainers, OpenTelemetry.

---

### Task 1: Create the workspace and dependency rules

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/worker/package.json`
- Create: `packages/core/package.json`
- Create: `packages/contracts/package.json`
- Create: `packages/db/package.json`
- Create: `packages/adapters/package.json`
- Create: `pnpm-workspace.yaml`
- Create: `docker-compose.yml`

- [ ] Configure workspace scripts for typecheck, lint, unit, integration and migration checks.
- [ ] Enforce imports so core cannot import Fastify, Drizzle, BullMQ, KIE, payment or S3 packages.
- [ ] Start local PostgreSQL, Redis and S3-compatible storage through Docker Compose.
- [ ] Add a health test proving API dependencies are wired without business logic.

### Task 2: Implement schema and migrations

**Files:**
- Create: `packages/db/src/schema/identity.ts`
- Create: `packages/db/src/schema/billing.ts`
- Create: `packages/db/src/schema/catalog.ts`
- Create: `packages/db/src/schema/generation.ts`
- Create: `packages/db/src/schema/media.ts`
- Create: `packages/db/src/schema/admin.ts`
- Create: `packages/db/migrations/0001_initial.sql`

- [ ] Implement the tables and constraints specified in `vgen-v2/docs/database.md`.
- [ ] Store money/credits as integer smallest units and all time as `timestamptz`.
- [ ] Make ledger and admin audit rows append-only with database permissions/triggers.
- [ ] Add unique idempotency constraints for orders, jobs, provider tasks, webhooks and ledger operations.
- [ ] Run migration up/down/up against an empty database and execute constraint tests.

### Task 3: Build identity and session use cases

**Files:**
- Create: `packages/core/src/identity/*`
- Create: `apps/api/src/routes/auth/*`
- Create: `packages/adapters/src/auth/google.ts`
- Create: `packages/adapters/src/auth/phone.ts`
- Create: `packages/adapters/src/auth/telegram.ts`

- [ ] Implement Google identity by verified `sub`, phone identity by E.164 and Telegram linking by server-side HMAC validation.
- [ ] Issue opaque, rotated, secure HttpOnly SameSite cookies.
- [ ] Protect account linking against duplicate provider identities.
- [ ] Add integration tests for login, logout, rotation, expiry, replay and linking conflicts.

### Task 4: Build catalog and pricing snapshots

**Files:**
- Create: `packages/core/src/catalog/*`
- Create: `packages/core/src/pricing/*`
- Create: `apps/api/src/routes/catalog.ts`
- Create: `apps/api/src/routes/quotes.ts`
- Create: `packages/adapters/src/providers/kie/catalog.ts`

- [ ] Import the current frontend model catalog into versioned database records through a validated seed command.
- [ ] Publish immutable catalog versions and atomically select the active version.
- [ ] Calculate authoritative quotes server-side and store provider cost, sell price, exchange rate, margin and expiry snapshots.
- [ ] Reject ambiguous provider-rate matches rather than selecting the first row.
- [ ] Add contract tests covering all current 528 combinations.

### Task 5: Implement wallet and append-only ledger

**Files:**
- Create: `packages/core/src/billing/ledger.ts`
- Create: `packages/core/src/billing/grants.ts`
- Create: `apps/api/src/routes/wallet.ts`
- Test: `packages/core/src/billing/ledger.test.ts`

- [ ] Implement expiring grants, earliest-expiry spending, reservation, capture, release, manual grant and refund as new ledger rows.
- [ ] Lock affected grants with `SELECT ... FOR UPDATE`.
- [ ] Make every operation idempotent and reject negative/overdraft outcomes.
- [ ] Test concurrent spends, retry, expiry boundaries, double settlement and admin adjustments.

### Task 6: Implement atomic job creation and outbox

**Files:**
- Create: `packages/core/src/generation/createJob.ts`
- Create: `packages/core/src/generation/settleJob.ts`
- Create: `packages/db/src/outbox.ts`
- Create: `apps/api/src/routes/jobs.ts`
- Create: `apps/worker/src/outboxConsumer.ts`

- [ ] In one transaction validate quote ownership/expiry, reserve credits, insert job and append outbox event.
- [ ] Return the job ID before provider submission.
- [ ] Publish outbox rows idempotently to BullMQ and mark delivery only after queue acknowledgement.
- [ ] Add concurrency tests proving one idempotency key creates one reservation and one job.

### Task 7: Implement media upload and provider worker

**Files:**
- Create: `packages/core/src/media/*`
- Create: `packages/adapters/src/storage/s3.ts`
- Create: `packages/adapters/src/providers/kie/client.ts`
- Create: `apps/worker/src/jobs/generate.ts`

- [ ] Validate file signatures, MIME, byte limits and media duration server-side.
- [ ] Upload input to owned storage, submit to KIE with an idempotency key, poll with bounded backoff and persist every state transition.
- [ ] Copy completed output to owned storage before marking the job done.
- [ ] Capture actual cost or release/refund reservation on terminal failure.
- [ ] Test provider timeout, malformed response, duplicate callback, partial upload and worker crash recovery.

### Task 8: Implement plans and payment

**Files:**
- Create: `packages/core/src/billing/orders.ts`
- Create: `packages/core/src/billing/payments.ts`
- Create: `packages/adapters/src/payments/gateway.ts`
- Create: `apps/api/src/routes/orders.ts`
- Create: `apps/api/src/routes/paymentCallback.ts`

- [ ] Create orders from server-owned plan prices only.
- [ ] Verify callbacks server-to-server and grant credits exactly once.
- [ ] Store every attempt and raw gateway reference without storing sensitive card data.
- [ ] Test duplicated callbacks, mismatched amount, cancelled payment, delayed verification and gateway outage.

### Task 9: Production operations

**Files:**
- Create: `packages/adapters/src/observability/*`
- Create: `apps/api/src/plugins/requestContext.ts`
- Create: `apps/worker/src/metrics.ts`
- Create: `docs/runbooks/jobs.md`
- Create: `docs/runbooks/ledger.md`

- [ ] Add request IDs, structured logs, traces and metrics for queue depth, job age, provider balance, actual margin and settlement failures.
- [ ] Add readiness/liveness checks that distinguish process health from dependency degradation.
- [ ] Document recovery for stuck jobs and ledger discrepancies without editing ledger rows.
- [ ] Run full integration tests and a worker-kill recovery test.

