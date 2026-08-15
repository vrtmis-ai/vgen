# Vgen Admin and Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a separately deployed admin application for monitoring operations and safely controlling jobs, users, catalog, presets and financial adjustments.

**Architecture:** The admin frontend is a separate React application on a separate apex domain and consumes only `/admin/*` APIs. Admin identity, sessions and permissions are separate from customer identity. Every mutation requires a reason, permission check, optimistic concurrency token and immutable audit event.

**Tech Stack:** React, Vite, TypeScript, TanStack Query/Table, Fastify admin routes, PostgreSQL, WebAuthn/TOTP MFA, Playwright.

---

### Task 1: Establish separate admin identity and authorization

**Files:**
- Create: `apps/admin-web/*`
- Create: `apps/api/src/admin/auth/*`
- Create: `packages/core/src/admin/permissions.ts`
- Create: `packages/core/src/admin/audit.ts`

- [ ] Implement separate admin users, credentials, sessions and cookie namespace.
- [ ] Require MFA and enforce IP allowlisting at proxy and application layers.
- [ ] Implement roles `content`, `commerce`, `support`, `owner` as explicit permissions, not `isAdmin`.
- [ ] Record login, failure, permission denial and every mutation in immutable audit rows.
- [ ] Test that a customer session can never authenticate to an admin route.

### Task 2: Build operational dashboard and queue monitor

**Files:**
- Create: `apps/api/src/admin/routes/dashboard.ts`
- Create: `apps/api/src/admin/routes/jobs.ts`
- Create: `apps/admin-web/src/features/dashboard/*`
- Create: `apps/admin-web/src/features/jobs/*`

- [ ] Show queue depth, oldest queued age, running count, failure rate, provider latency/balance and unsettled jobs.
- [ ] Provide filters by state, model, provider, user, request ID and time window.
- [ ] Allow support to retry only retryable failed jobs and refund through a billing use case.
- [ ] Require a reason and confirmation for retry/cancel/refund; never mutate job history.
- [ ] Test stale-row concurrency, double action and unauthorized action.

### Task 3: Build user support and ledger views

**Files:**
- Create: `apps/api/src/admin/routes/users.ts`
- Create: `apps/api/src/admin/routes/ledger.ts`
- Create: `apps/admin-web/src/features/users/*`
- Create: `apps/admin-web/src/features/ledger/*`

- [ ] Search users by internal ID, normalized phone/email identity and provider identity without exposing secrets.
- [ ] Display grants, ledger entries, jobs, orders and payment attempts as timelines.
- [ ] Allow authorized manual grants/refunds only as append-only commands with integer amount and mandatory reason.
- [ ] Show the resulting audit event and ledger operation ID after success.

### Task 4: Build safe catalog and model management

**Files:**
- Create: `apps/api/src/admin/routes/catalog.ts`
- Create: `apps/admin-web/src/features/catalog/*`
- Create: `packages/core/src/catalog/validateCatalog.ts`

- [ ] Support draft catalog versions rather than editing the active catalog in place.
- [ ] Edit model metadata, variants, controls, provider mapping, tier, availability, margin and ordering.
- [ ] Run the complete combination/pricing validator before publication and display exact blocking combinations.
- [ ] Publish atomically with an audit reason and retain rollback to a previous immutable version.
- [ ] Prevent adding a model/variant with no price resolver or unsupported required input.

### Task 5: Build preset and content management

**Files:**
- Create: `apps/api/src/admin/routes/content.ts`
- Create: `apps/admin-web/src/features/content/*`
- Modify: `src/data/content.ts`
- Modify: `src/data/featured.ts`

- [ ] Manage presets, effects, courses, featured shelves and banners with draft/published/archived status, order, updatedAt and updatedBy.
- [ ] Add asset upload, preview and scheduled display windows.
- [ ] Make customer APIs return published content only; admin preview requests require content permission.
- [ ] Convert `FEATURED` to the common content record contract.

### Task 6: Build community moderation

**Files:**
- Create: `apps/api/src/admin/routes/community.ts`
- Create: `apps/admin-web/src/features/community/*`

- [ ] Show pending posts with source generation, consent timestamp, perceptual match and reports.
- [ ] Allow content admins to approve, reject or remove with mandatory reason.
- [ ] Preserve moderation history and prevent deleted content from silently losing its audit trail.

### Task 7: Build commerce configuration and reporting

**Files:**
- Create: `apps/api/src/admin/routes/commerce.ts`
- Create: `apps/admin-web/src/features/commerce/*`

- [ ] Manage draft plan/rate configuration with effective dates and publish workflow.
- [ ] Report revenue, provider cost, realized margin, usage by model, team-account separation and payment failures.
- [ ] Require owner approval for permission changes and high-value financial adjustments.
- [ ] Export sanitized CSV with audit logging of who exported which time range.

### Task 8: Verify admin security and deploy separately

**Files:**
- Create: `apps/admin-web/e2e/security.spec.ts`
- Create: `apps/admin-web/e2e/operations.spec.ts`
- Create: `docs/runbooks/admin-access.md`

- [ ] Test customer/admin session separation, MFA, IP denial, CSRF, permission matrix and session revocation.
- [ ] Test every mutation produces an audit row containing actor, target, before, after, reason, request ID and timestamp.
- [ ] Deploy admin on a separate apex domain with no link or route from the customer app.
- [ ] Run end-to-end queue retry, refund, catalog publish and preset publish flows against staging.

