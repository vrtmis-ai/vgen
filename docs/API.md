# Backend API

What the server actually serves today, and how the web tier reaches it. Written
for whoever is building UI against it — including agents, which is why every
claim here names the file it can be checked against.

**Maintained by the backend owner.** If it disagrees with the code, the code is
right and this file is a bug — say so.

Last verified against `main` on 2026-08-15.

## The two runtimes

The web tier never calls `fetch` directly. Screens use `useAppServices()`
(`src/runtime/AppServices.tsx`), which resolves to one of two implementations
based on `NEXT_PUBLIC_APP_MODE`:

| Mode         | Implementation       | What it needs                                                   |
| ------------ | -------------------- | --------------------------------------------------------------- |
| `demo`       | `src/adapters/demo/` | Nothing. In-memory, deterministic                               |
| `production` | `src/adapters/http/` | `NEXT_PUBLIC_API_BASE_URL`, e.g. `http://127.0.0.1:5181/api/v1` |

The port is the same either way — `AppServices` in
`src/runtime/AppServices.tsx`. Build against that interface and both modes work.

## What is actually wired

This is the part worth reading twice. The HTTP adapters were written against a
planned surface; the server has since been rebuilt, and **four of the eight
calls the frontend makes have no route on the server yet.**

| `AppServices` call     | Frontend requests          | Server route                           | Status   |
| ---------------------- | -------------------------- | -------------------------------------- | -------- |
| `session.getCurrent()` | `GET /session`             | `routes/session.ts`                    | **Live** |
| `auth.*` (5 methods)   | `POST /auth/*`             | `routes/auth.ts`                       | **Live** |
| `catalog.list()`       | `GET /catalog`             | `routes/catalog.ts`                    | **Live** |
| `wallet.getCurrent()`  | `GET /wallet`              | `routes/wallet.ts`                     | **Live** |
| `generation.quote()`   | `POST /generation/quotes`  | —                                      | **404**  |
| `generation.create()`  | `POST /generation/jobs`    | `POST /jobs` (different path and body) | **404**  |
| `generation.getJob()`  | `GET /generation/jobs/:id` | —                                      | **404**  |
| `gallery.list()`       | `GET /gallery`             | —                                      | **404**  |

So in `production` mode today, session, auth, catalog and wallet work;
generation and gallery do not. **In `demo` mode everything works**, which is why
UI work is unblocked and should stay on demo mode until this table says
otherwise.

One caveat on `catalog.list()`: the route is live but **the catalog tables are
empty**, so it returns a snapshot with zero families. Demo mode returns the real
catalog. Populating it is the next phase of backend work.

Do not "fix" this from the UI side by changing the adapter paths — the server
routes genuinely are not built, and the mismatch is tracked as backend work.

## Live endpoints

Base path is `/api/v1`. Every response is JSON. Session comes from an HttpOnly
cookie, so the browser sends it automatically; the HTTP client sets
`credentials: "include"`.

### `GET /session`

Who, if anyone, is signed in. Never 401s — anonymous is a normal answer.

```jsonc
{ "status": "anonymous", "host": "web" }
// or
{ "status": "authed", "host": "web",
  "user": { "id": "…", "methods": ["email"], "emailNormalized": "a@b.c",
            "displayName": "…", "locale": "fa", "isTeam": false } }
```

Schema: `SessionSchema` in `src/runtime/contracts/session.ts`.

### `GET /catalog`

The model catalog — families, variants, controls, reference slots. This is what
drives every picker in the studio screens.

```jsonc
{ "version": "…", "publishedAt": 1234567890, "families": [/* FamilySchema[] */] }
```

Schema: `CatalogSnapshotSchema` / `FamilySchema` in
`src/runtime/contracts/catalog.ts`. That file is the authority on what a control
or a reference slot may contain — it is a discriminated union, so an unknown
`kind` is a parse error rather than a silently ignored field.

### `GET /wallet`

Requires an authed session; 401 otherwise.

```jsonc
{
  "spendable": 32,
  "grants": [{ "id": "…", "kind": "signup_gift", "coinsGranted": 12, "coinsRemaining": 12, "grantedAt": 0, "expiresAt": 0 }],
  "nextExpiry": { "at": 0, "coins": 12 },
}
```

Schema: `WalletSchema` in `src/runtime/contracts/wallet.ts`.

**Coins, not micro-credits.** The database stores BIGINT micro-credits
(1 coin = 1,000,000) so nothing in the money path is a float; the API converts
at the boundary. The UI only ever sees whole coins. Never do money arithmetic in
a screen — ask for a field instead.

### `POST /jobs`

Exists and is authed, but the frontend does not call it yet (see the table
above). Takes an `Idempotency-Key` header and a `{ quoteId, params }` body,
answers `202` with the job. Returns `402 insufficient_credits`,
`404 quote_unavailable`, or `409` on an idempotency or quote conflict.

Source: `apps/api/src/routes/jobs.ts`.

### `POST /telemetry/errors`

Sanitized crash reports from the browser. Already wired through
`src/runtime/telemetry.ts` — you should not need to call it directly. It
deliberately rejects prompts, messages, stacks and query strings, because a
crash report is not a place to leak what a user typed.

### `GET /health/live` · `GET /health/ready`

Unprefixed — **not** under `/api/v1`. `ready` reports database, Redis and
storage individually.

## Authentication

**Wired, both modes.** `AppServices.auth` has the five methods, with an HTTP
implementation and a demo one, so a sign-in screen can be built and tested with
no backend running.

Call it through **`useAuth()`** (`src/features/session/useAuth.ts`), not the
port directly — it wraps each call in a mutation and invalidates the session,
wallet and catalog caches on success, which is what actually moves the app from
the landing page into the workspace.

```tsx
const { login } = useAuth();

async function submit() {
  try {
    await login.mutateAsync({ email, password });
    // Nothing else to do. The gate re-renders into the workspace by itself.
  } catch (error) {
    // Branch on the code, never the message. Both adapters throw the same
    // ApiError class, so this works identically in demo and production.
    if (error instanceof ApiError && error.code === "invite_required") showInviteField();
  }
}

// login.isPending / login.error are there for the button and the message.
```

The **two-step phone flow** is the only one with state between calls: hold the
phone number from `startPhoneVerification` and pass it back to `verifyPhone`
with the code. `expiresAt` is when the code dies — it is what a resend
countdown should count to.

**Building the screen:** run with `NEXT_PUBLIC_DEMO_ANONYMOUS=1` so demo mode
starts signed out — otherwise the demo session is already authed and the
landing page never renders. In demo mode the OTP code is `123456`, an invite
code is required (as in production), `INVALID` is rejected as a bad code, and
`taken@deev.local` reports `account_taken`, so every branch is reachable
offline.

Still stubs on purpose: `signIn` and `signUp` in
`src/runtime/providers/authActions.ts` are what the landing page's buttons call,
and they warn rather than navigate because the screen they should open does not
exist yet. Point them at it when you build it. `signOut` is live.

| Route                                        |                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /auth/otp/start`                       | `{ phone }` → `202 { sent: true, expiresAt }`. The route most Iranian users take |
| `POST /auth/otp/verify`                      | `{ phone, code, inviteCode?, deviceFingerprint? }` → session cookie              |
| `POST /auth/register`                        | `{ email, password, inviteCode?, deviceFingerprint? }` → `201`                   |
| `POST /auth/login`                           | `{ email, password }` → `200`                                                    |
| `POST /auth/logout`                          | → `204`, always, and says nothing about whether a session existed                |
| `GET /auth/google` · `/auth/google/callback` | Registered only when Google credentials are configured                           |

Schemas: `packages/contracts/src/auth.ts`. They are `.strict()`, so an extra key
is a `validation_failed`, not an ignored field.

Things a UI needs to know about these:

- **Phone numbers are accepted as typed** — `0912…`, `+98912…`, `98912…`,
  Persian digits — and normalised server-side. Do not pre-format them; two
  spellings of one number must not become two accounts.
- **Early access is on.** Signup without an invite code answers
  `403 invite_required`. A bad or revoked code answers `400 invite_invalid`.
- **The free trial is keyed on phone.** An email signup through a 20-coin invite
  has 20 coins, not 32 — the 12-coin trial only comes with the phone route.
  This is deliberate, not a missing grant.
- Passwords have a floor of 10 characters and a ceiling of 512.

## Errors

Every failure has the same shape:

```jsonc
{ "error": { "code": "invite_required", "message": "DEEV is in early access and needs an invite code", "request_id": "req-l" } }
```

Both adapters reject with the same `ApiError` (`src/runtime/apiError.ts`, also
re-exported from `src/adapters/http/client.ts`), carrying `code`, `status`,
`requestId` and `retryAfterMs`. **Branch on `code`, never on `message`** —
messages are prose and will change; codes are the contract.

One class in both modes is deliberate and enforced by
`src/adapters/parity.test.ts`. A screen identifies a failure with
`error instanceof ApiError`, and a demo-only error class that merely copied the
fields would make that check pass in production while failing in the mode the
screen was built in.

| Code                          | Status |                                                                |
| ----------------------------- | ------ | -------------------------------------------------------------- |
| `unauthorized`                | 401    | No session, or it expired                                      |
| `invite_required`             | 403    | Early access is on and no code was given                       |
| `invite_invalid`              | 400    | Unknown, expired, capped or revoked code                       |
| `invalid_credentials`         | 401    | Wrong email or password                                        |
| `account_taken`               | 409    | That address already has an account                            |
| `account_suspended`           | 403    |                                                                |
| `otp_invalid` · `otp_expired` | 400    |                                                                |
| `otp_exhausted`               | 429    | Too many wrong codes                                           |
| `rate_limited`                | 429    | Carries `Retry-After`; surface the wait, do not silently retry |
| `insufficient_credits`        | 402    |                                                                |
| `validation_failed`           | 400    | Body did not match the contract; `details.fields` says where   |
| `invalid_request`             | 400    | Malformed request — bad JSON, empty body declared as JSON      |
| `payload_too_large`           | 413    |                                                                |
| `internal_error`              | 500    | Never carries detail; `request_id` is the way to trace it      |

`404` from an admin route means "you are not staff" — the surface is not
confirmed to someone probing for it.

## Admin

`/api/v1/admin/*` — invite and discount CRUD, per-code usage and spend, and the
early-access switch. Complete and tested, with **no UI**; `src/screens/Admin.tsx`
still talks to local storage.

Not a normal frontend surface: it needs a staff role, a separate cookie, and a
confirmed second factor. If you are building admin screens, ask first — the
sign-in is two steps and the session authorises nothing between them.

## Not built yet

So you can tell a gap from a bug:

- **The catalog is empty in the database.** `GET /catalog` is live but returns
  zero families; the model, provider and price tables have no rows yet. Demo
  mode has the real catalog, which is where UI work should stay.
- **Generation submission end to end.** `POST /jobs` exists; the quote and
  job-status routes the frontend expects do not, and pricing has nothing to read.
- **Gallery.** No server route. Demo mode returns an empty page.
- **The queue consumer.** Jobs can be created; nothing processes them.
- **Payments.** Plans render and price correctly; nothing charges.
- **A sign-in screen.** The port and both adapters are done — see
  Authentication. The screen itself is UI work.

## Asking for a change

`packages/contracts/` is the boundary between the two halves. When a screen
needs something the API does not return:

1. Open an issue or say so directly — do not add a `fetch` to a screen.
2. If the shape is obvious, propose it as a Zod schema in
   `packages/contracts/src/`. That is a small, reviewable PR and it is the
   fastest way to get the route built to match.
3. Keep building against `src/adapters/demo/` meanwhile. Extending a demo
   adapter to return the shape you want is fair game and does not need the
   backend owner — that is what it is for.
