# DEEV

Next.js (App Router) web tier, a Fastify API, and a queue worker in one pnpm
workspace. Persian-first, RTL, Iranian market.

## Local development

`.env` selects deterministic demo services, so the UI runs with no backend at
all:

```sh
pnpm dev            # http://localhost:5180
```

For the real local stack (PostgreSQL, Redis, MinIO, migrations, API, and web),
keep Docker Desktop running and use:

```sh
pnpm dev:stack
```

Next 16 refuses to start a second dev server in the same directory, so stop
`pnpm dev` before running `pnpm test:e2e` — Playwright starts its own on 5182.

## Configuration

Copy `.env.example` to `.env.development.local` (ignored by Git).

Browser configuration is `NEXT_PUBLIC_`-prefixed and **is served to every
visitor** — never put a secret behind that prefix. Next only substitutes literal
`process.env.NEXT_PUBLIC_X` member expressions, so every browser-side read is
spelled out in one place: `browserEnvironment()` in `src/runtime/runtime.ts`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_MODE` | `demo` for in-memory services, `production` for the HTTP adapters |
| `NEXT_PUBLIC_API_BASE_URL` | Required when not in demo mode, e.g. `http://127.0.0.1:5181/api/v1` |
| `NEXT_PUBLIC_APP_RELEASE` | Release identifier attached to sanitized crash reports |
| `DATABASE_URL`, `REDIS_URL`, `OBJECT_STORAGE_*` | API and worker only |

## Authentication

**There is currently no working sign-in.** Clerk was removed with the Next.js
migration: its SMS delivery and Google sign-in are both unreliable to Iranian
numbers and addresses, which is the entire market.

DEEV's own auth replaces it — phone OTP through an Iranian SMS gateway, email +
password, and Google OAuth, over the deev-db `users` / `auth_identities` /
`sessions` tables. Until then `AnonymousPrincipalResolver`
(`apps/api/src/customerSession.ts`) resolves every request to nobody, so
protected routes answer 401 rather than inventing an identity, and the UI runs
in demo mode.

## Deployment

A Node server, via `output: "standalone"`. This replaced a GitHub Pages static
export that served the app from a `/vgen/` sub-path; it now serves from the
domain root, and there is no `basePath`.
