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

## Database

91 tables, applied by `packages/db/src/migrate.ts` from `packages/db/migrations/`
in filename order, each file in its own transaction.

```sh
docker compose up -d --wait
pnpm db:migrate
docker compose exec -T postgres psql -U vgen -d vgen -v ON_ERROR_STOP=1 < packages/db/smoke.sql
```

The smoke file is the schema's test: ~54 assertions in one transaction that ends
in `ROLLBACK`, so it is safe to run against any database.

Two things about the container are load-bearing:

- **Postgres listens on 5442, not 5432.** A native PostgreSQL Windows service
  and the sibling `deev-db` compose stack both want 5432; when two listeners
  share a port the wrong one answers, and the error reads as a password failure
  rather than a conflict.
- **The ICU `fa-IR` collation is set by initdb and only by initdb.** Persian
  sorts wrongly under `en_US.utf8`, which files Latin first and splits the ک/ك
  and ی/ي pairs users type interchangeably. Changing it later means a dump and
  restore, so `docker compose down -v` and re-migrating is the way to reset.

Money is stored as BIGINT **micro-credits**, 1 credit = 1,000,000, so nothing in
the money path is ever a float. Credit only moves through the functions in
`0010_credit_functions.sql` — `grant_credits`, `hold_credits`, `capture_hold`,
`release_hold` — because each movement has to keep the lots, the append-only
ledger, the hold records and the cached balance in step, and the reconciliation
views in `0004` exist to catch the case where it did not.

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

DEEV's own, replacing Clerk — whose SMS delivery and Google sign-in are both
unreliable to Iranian numbers and addresses, which is the entire market.

| Route | |
|---|---|
| `POST /api/v1/auth/otp/start` · `/otp/verify` | Phone OTP. The route most users will take |
| `POST /api/v1/auth/register` · `/login` | Email + password |
| `GET /api/v1/auth/google` · `/google/callback` | Google. Registered only when credentials are set |
| `POST /api/v1/auth/logout` | |

A session is a row in `sessions` addressed by an opaque 256-bit token in an
HttpOnly cookie, and it is resolved against the database on every request — no
JWT, because a revoked session has to stop working immediately.

Passwords use Node's built-in scrypt with the cost parameters stored alongside
each hash, so they can be raised later without invalidating anyone's password.

Rate limits come from the `rate_limit_policies` rows, with the counters in
Redis: an operator can loosen OTP sending during a campaign without a deploy.
Phone numbers are accepted in every form Iranians write them (`0912…`,
`+98912…`, Persian digits) and normalised server-side, because two spellings of
one number would otherwise be two accounts with two free trials.

## Early access

Signup is invite-only while `feature_flags.early_access` is on. Opening the
product is one `UPDATE`.

- **Invite codes** decide who may create an account. Campaign codes carry a
  redemption cap and optional free credits (`apple-deev`, capped at 500, worth
  20 credits); members can also invite friends, which records a referral that
  stays `pending` until the friend pays.
- **Discount codes** decide what someone pays: percent-off, flat-Toman-off,
  free credits, or a free term, optionally restricted to a first purchase.
- **Deleting either is revocation.** A hard delete would orphan the redemption
  history — the campaign's result, and the trail for tracing an abusive
  inviter. Codes nobody has used can be deleted outright.

`v_invite_performance` answers "how many people used this code and how many
credits did they spend", reading `lifetime_spent` straight off the ledger's own
numbers rather than a second counter that could drift.

## Deployment

A Node server, via `output: "standalone"`. This replaced a GitHub Pages static
export that served the app from a `/vgen/` sub-path; it now serves from the
domain root, and there is no `basePath`.
