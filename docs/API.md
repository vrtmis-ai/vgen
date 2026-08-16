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

`catalog.list()` used to carry a caveat here — the route was live but the tables
were empty. That is fixed: all 19 families and 44 variants are in Postgres, and
the two modes now serve the same bytes (see below).

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
drives every picker in the studio screens. 19 families, 44 variants.

```jsonc
{ "version": "…", "publishedAt": 1234567890, "families": [/* FamilySchema[] */] }
```

Schema: `CatalogSnapshotSchema` / `FamilySchema` in
`src/runtime/contracts/catalog.ts`. That file is the authority on what a control
or a reference slot may contain — it is a discriminated union, so an unknown
`kind` is a parse error rather than a silently ignored field.

**Order is meaningful and guaranteed.** Families come back in catalog order and
variants in family order — the order the switchers should present them, most
recommended first. Do not sort them.

**New field: `variant.featureCode`.** It names the section of the product a
variant belongs to — `image_generate`, `image_edit`, `video_generate`,
`image_to_video`, `video_edit`, `speech_generate`. A screen mostly does not need
it, but it is the honest way to answer "is this thing a generator or an
editor?", and it is what a job gets filed under. It is required, so it is always
there.

Two consequences worth knowing, because neither is guessable from the family:

- `topaz` is an `image` family whose second variant, `topaz-video-upscale`, is
  `video_edit`. A family's `kind` is not its variants' modality.
- Both `hailuo` variants are `image_to_video` — there is no text-only path
  through them, and their `image_url` slot is `required: true`. Their neighbours
  in `kling` and `wan` are `video_generate` and take an image optionally.

**Where it comes from.** `provider_models`, grouped by the `family` column, with
everything a screen renders in `capabilities`. Not a table of frozen JSON
documents any more — the rows the router and the pricing tables already point
at. A change to `src/data/models.ts` reaches the API through
`pnpm catalog:publish`, which is idempotent; the version string derives from the
newest row's `updated_at`, so it changes exactly when the catalog does.

**Demo mode serves the same document.** `src/data/catalog.snapshot.json` is
generated out of Postgres by `pnpm catalog:snapshot` and committed, and demo
mode reads it instead of importing `FAMILIES`. Two CI checks pin it: a unit test
that the committed file equals `FAMILIES`, and a database job that reseeds,
re-exports, and diffs. So a screen built against demo mode is built against what
production actually sends — which is the claim demo mode has to keep.

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

| Route                                              |                                                                                  |
| -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `POST /auth/otp/start`                             | `{ phone }` → `202 { sent: true, expiresAt }`. The route most Iranian users take |
| `POST /auth/otp/verify`                            | `{ phone, code, inviteCode?, deviceFingerprint? }` → session cookie              |
| `POST /auth/register`                              | `{ email, password, inviteCode?, deviceFingerprint? }` → `201`                   |
| `POST /auth/login`                                 | `{ email, password }` → `200`                                                    |
| `POST /auth/logout`                                | → `204`, always, and says nothing about whether a session existed                |
| `GET /auth/google` · `/auth/google/callback`       | Registered only when Google credentials are configured                           |
| `GET /auth/microsoft` · `/auth/microsoft/callback` | Registered only when Microsoft credentials are configured                        |

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
- **Social sign-in is a full-page navigation, not `fetch`.** Send the browser to
  `/auth/google` or `/auth/microsoft` — an `<a href>`, not an XHR. Both set a
  short-lived state cookie and redirect off-site, so a same-origin fetch will
  fail CORS and drop the cookie that makes the callback safe. The provider
  returns the browser to `WEB_ORIGIN` with the session cookie already set, so
  the screen's job afterwards is simply to refetch the session.
- **A failed social sign-in comes back as `?auth=<code>` on the landing page**,
  not as a JSON error — there is no response to read when the browser is
  mid-redirect. Expect `oauth_failed`, `invite_required`, `invite_invalid` or
  `account_suspended`, and `failed` for a CSRF-state mismatch. Nothing in the UI
  reads this yet.
- **Neither provider is reachable from Iran without a VPN**, so treat them as
  secondary next to the phone route rather than the prominent option, and expect
  both to be absent in most deployments — a provider without credentials has no
  endpoint at all, and its button would go to a 404.

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

- **Pricing.** `model_prices` is still empty, so nothing can quote. The rate
  table is in `packages/core` for now; moving it into those rows is the next
  phase, and until it lands a quote has nothing to read.
- **Generation submission end to end.** `POST /jobs` exists; the quote and
  job-status routes the frontend expects do not.
- **Gallery.** No server route. Demo mode returns an empty page.
- **The queue consumer.** Jobs can be created; nothing processes them.
- **Payments.** Plans render and price correctly; nothing charges.
- **A sign-in screen.** The port and both adapters are done — see
  Authentication. The screen itself is UI work.
- **Some screens still read `FAMILIES` directly.** `getFamily()` in Community,
  Effects, Profile, Mcp and AssetViewer, and the whole list in Landing, import
  `src/data/models.ts` rather than going through `useCatalogFamilies()`. Nothing
  is broken by it today — the committed snapshot and the API are the same
  document — but those screens read a compiled-in constant instead of the served
  catalog, so a family retired in the database would keep rendering. Porting
  them is UI work and the port is already there.

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
