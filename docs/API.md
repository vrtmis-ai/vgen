# Backend API

What the server actually serves today, and how the web tier reaches it. Written
for whoever is building UI against it — including agents, which is why every
claim here names the file it can be checked against.

**Maintained by the backend owner.** If it disagrees with the code, the code is
right and this file is a bug — say so.

Last verified against `main` on 2026-08-17.

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
planned surface; the server has since been rebuilt, and **one of the eight
calls the frontend makes has no route on the server yet.**

| `AppServices` call     | Frontend requests          | Server route                           | Status   |
| ---------------------- | -------------------------- | -------------------------------------- | -------- |
| `session.getCurrent()` | `GET /session`             | `routes/session.ts`                    | **Live** |
| `auth.*` (5 methods)   | `POST /auth/*`             | `routes/auth.ts`                       | **Live** |
| `catalog.list()`       | `GET /catalog`             | `routes/catalog.ts`                    | **Live** |
| _(not wired yet)_      | `GET /plans`               | `routes/plans.ts`                      | **Live** |
| `wallet.getCurrent()`  | `GET /wallet`              | `routes/wallet.ts`                     | **Live** |
| _(not wired yet)_      | `POST /generation/quotes`  | `routes/quotes.ts`                     | **Live** |
| _(not wired yet)_      | `POST /generation/jobs`    | `POST /jobs` (different path and body) | **Live** |
| _(not wired yet)_      | `GET /generation/jobs/:id` | `routes/jobs.ts`                       | **Live** |
| `gallery.list()`       | `GET /gallery`             | —                                      | **404**  |

So in `production` mode today, session, auth, catalog, wallet, plans, quoting
and job submission all work; only the gallery does not. A submitted job now
genuinely runs — the worker consumes the queue, calls the provider and settles
the money — but there is nowhere to _see_ the result yet, because the gallery
route and the storage that backs it are the next phase. **In `demo` mode
everything works**, which is why UI work is unblocked and should stay on demo
mode until this table says otherwise.

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

### `GET /plans`

The plan ladder. Public on purpose: someone deciding whether to sign up has to
see what a plan costs before they have an account to see it with.

```jsonc
{
  "plans": [
    {
      "code": "pro",
      "name": "Pro",
      "tier": 2,
      "coinsPerTerm": 1100,
      "baseCoins": 1000,
      "bonusCoins": 100,
      "termDays": 30,
      "monthlyUsd": 49,
      "annualUsdPerMonth": 39,
      "group": "main",
      "tag": "popular",
      "popular": true,
      "maxConcurrentJobs": 4,
    },
  ],
}
```

Schema: `PlanSchema` in `packages/contracts/src/plans.ts`, mirrored for the
browser in `src/runtime/contracts/plans.ts`. Ordered the way the cards are meant
to read — do not sort it.

**This is what the UI reads.** `AppServices.plans.list()` fetches it once, the
app shell puts it in `PlansProvider`, and the plans screen, the landing page's
price cards and the access gate's padlock all read it from there. Nothing
renders a price from a file any more. Demo mode serves
`src/data/plans.snapshot.json` — the database's own export, committed and diffed
in CI — so a screen built without a backend is built against the real payload.
`plans.rows.json` beside it is the seeder's *input*; both are generated, so
**do not hand-edit either.**

Five things worth knowing:

- **Prices are USD.** The coin economy pivots on USD, so the Toman figure a
  customer sees is a conversion applied at the edge and a rate change moves one
  number instead of every plan row.
- **`annualUsdPerMonth: null` is not the same as "same as monthly".** Null means
  the plan has no annual option and the toggle should not appear; an equal price
  would mean a discount of zero.
- **`termDays` is 30 on every plan, annual ones included.** Annual is a payment
  cadence, not a longer grant — twelve months are paid up front but coins still
  arrive monthly and still expire after thirty days.
- **`coinsPerTerm` is the total; `baseCoins` + `bonusCoins` is the same number
  split the way the card shows it** ("500 + 25"). Charge against the total.
- **`maxConcurrentJobs` is how many generations the plan may have in flight at
  once** — 1 on Starter up to 8 on Creator, and 1 for an account with no plan.
  It is a perk, not a throttle: queueing behind your own jobs is what a dearer
  plan buys you out of. The ladder is monotonic with price and a unit test
  enforces that, because paying more must never buy less parallelism.

**Tier gating.** `plans.tier` is compared against a family's `minTier`, a
required field on every family in `GET /catalog`. An account with no plan is
tier 1, not tier 0 — it holds a 12-coin signup gift and the cheapest tier-1
models cost about a coin, so tier 1 is what makes that gift spendable.

**This is now enforced on the server**, in `POST /generation/quotes`. It used to
be browser-only, which meant it was not enforced at all: `src/lib/access.tsx`
draws a padlock and curl has never seen a padlock. Keep drawing the padlock —
it is much better UX than a 403 — but the padlock is now a mirror of the rule
rather than the rule.

### `POST /generation/quotes`

What a generation costs **this** account. Authenticated, unlike `GET /plans`:
the price depends on the plan's tier and on how much of today's free allowance
is left, and neither question has an answer for a stranger.

```jsonc
// request
{
  "variantId": "nano-banana-pro",
  "params": { "resolution": "1K" },
  "prompt": "a city at night", // priced only by the per-1k-character models
  "clipSeconds": 8, // only for models billed by an attached clip's length
}
```

```jsonc
// 200
{
  "id": "0199...",
  "coins": 0,
  "expiresAt": 1755353400000,
  "unlimited": { "remainingToday": 47, "dailyCap": 50 },
  "concurrency": { "running": 2, "limit": 4 },
}
```

Note what the request does **not** contain: no feature, no model id, no price.
Those are catalogue facts the server looks up from `variantId`. A request that
could name them is a request that could ask to be billed as something cheaper.

- **`coins` is authoritative, and `0` is a real answer** — see Unlimited below.
- **`unlimited` is present only when the zero came from a grant** rather than
  from a zero price, so you can say _why_ it is free and what is left.
- **`concurrency` is always present.** Price is not the only reason a
  generation might not start. Quoting is deliberately **not** refused when the
  account is full — the price is still the price, and a client that knows it is
  at 4 of 4 can say so instead of finding out by being rejected.
- **Quotes expire in five minutes** and are bound to a hash of `params`, so a
  cheap quote cannot be spent on an expensive job.
- **Asking the price consumes nothing.** The free allowance is spent at job
  submission, never here — a quote a customer never acts on must not cost them
  part of their day.

| Status | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| 401    | Not signed in                                                          |
| 403    | `tier_too_low` — body carries `requiredTier` and `currentTier`         |
| 404    | `unknown_variant`                                                      |
| 409    | `not_offered` / `no_price` — the variant exists, those settings do not |

403 rather than 402 on tier: the account is not short of money, it is on the
wrong plan, and the fix is an upgrade rather than a top-up.

### `POST /jobs`

Turns a quote into a queued job. Requires an `Idempotency-Key` header.

```jsonc
// request — params must be byte-identical to what was quoted
{ "quoteId": "0199…", "params": { "resolution": "1K" } }
```

```jsonc
// 202
{ "id": "0199…", "status": "queued", "modelKey": "gpt-image-2", "quotedCredits": 2, "createdAt": 1755353400000 }
```

One transaction does all of it: the credit hold (or the free-allowance claim),
the job row, and the outbox event that tells the worker. Either all three exist
or none do — a job with no hold generates for free, a hold with no job is money
taken for nothing, and a job with no outbox row sits queued forever.

- **Retry with the same `Idempotency-Key` and you get the original job back**,
  not a second charge. Reuse that key for a _different_ quote and it is a 409 —
  answering with the first job would be a lie about what was submitted.
- **A quote is single-use.** The second submission against it is `quote_spent`.
- **Coins are held, not charged.** What a generation actually costs is only
  known once it has run; a failure must give all of it back.
- **A granted generation holds nothing** and spends one of the day's allowance
  instead. Ask for a price again and `remainingToday` has moved.

| Status | Code                                                                           |
| ------ | ------------------------------------------------------------------------------ |
| 402    | `insufficient_credits`                                                         |
| 404    | `quote_unavailable` — missing, or somebody else's                              |
| 409    | `quote_spent` · `params_mismatch` · `idempotency_conflict` · `allowance_spent` |
| 410    | `quote_expired` — ask for a new price                                          |
| 429    | `concurrency_reached` — at the plan's `maxConcurrentJobs`                      |

410 rather than 409 for an expired quote: the thing referenced genuinely used to
exist and no longer does, and the fix is a fresh quote rather than a fixed
request.

### `GET /generation/jobs/:jobId`

The same shape, scoped to the caller. Somebody else's job is a **404, not a
403** — a job id is not a capability, and a 403 would confirm it exists.

Poll this after submitting. `status` walks `queued` → `running` → `succeeded`
or `failed`; the terminal states are final and nothing moves afterwards.

## What happens after a job is queued

`apps/worker` does two things: it drains the outbox onto BullMQ, and it
consumes that queue. The consumer is `runGeneration` in
`apps/worker/src/runGeneration.ts`, and it is worth knowing what it guarantees
because the UI's error states follow from it.

1. **Claim.** The job goes `running`. A job already claimed by a worker that
   then died is re-claimable, so a crash mid-generation does not strand the
   customer's credits.
2. **Pick a credential.** `provider_credentials` is a pool; the picker takes
   the least-recently-used active account for that provider and prefers one
   with daily headroom. The row stores the _name_ of an environment variable,
   never a token.
3. **Call the provider.** Every call writes a `job_attempts` row — the request
   bytes, the response bytes, the HTTP status, the latency, what it cost in the
   provider's own units, and which credential served it.
4. **Settle.** On success: the outputs become `assets` rows and `capture_hold`
   charges the quoted price. On failure: `release_hold` gives every coin back,
   and a granted job gets its slice of the day's allowance back too.

**A user never pays for a generation they did not get.** That is the one
invariant the whole phase exists to hold, and every exit from the runner either
captures because a file exists or releases because one does not.

A transient failure — a dead socket, a 5xx — is retried by the queue with
exponential backoff and settles nothing in between, so a flaky network does not
turn into a stream of holds and releases on somebody's ledger. A refusal
(rejected prompt, unknown model, missing credential) settles immediately: the
answer will not change, and making somebody wait through five backoffs to be
told no is worse than telling them now.

The `error_code` on a failed job is the provider's own where there is one, or
one of ours:

| `error_code`             | Means                                                         |
| ------------------------ | ------------------------------------------------------------- |
| `provider_unavailable`   | No adapter for that provider — configuration, not weather     |
| `credential_unavailable` | No active credential, or its secret is not in the environment |
| `submit_failed`          | The provider would not accept the task                        |
| `poll_failed`            | The provider stopped answering about a task it accepted       |
| `provider_timeout`       | Accepted, never finished                                      |
| `no_output`              | Reported success and returned no files                        |

`no_output` is a failure on purpose. Capturing a hold there would charge
somebody for an empty gallery.

### KIE is wired; useapi is not

`packages/adapters/src/providers/kie.ts` is written against the shapes
`scripts/spike-kie.ts` verified on the live API — including the two the docs do
not tell you: a 200 can carry a failure (the task id's absence is the error),
and `resultJson` is a JSON string nested inside the JSON body.

There is **no useapi adapter**, and that is deliberate rather than unfinished.
No token for their API exists in any environment we control, so the external
model ids on the serving rows came from a published list rather than from a
call that returned 200 — and an adapter written against a guess would typecheck
while being wrong. `createGenerationProvider` returns null for it, the runner
turns that into `provider_unavailable`, and the customer is refunded in full.
Which means **unlimited generations currently quote free, submit, and then
fail** — costing nobody anything, but producing no picture. Wiring it needs a
`USEAPI_*` token and a spike like KIE's.

## Unlimited generation

Some models cost us nothing per generation, and those are quoted at **zero
coins** rather than at a discount.

KIE bills per image. A PixVerse Pro+ subscription reached through useapi.net
bills a flat monthly fee and then nothing per image — past a daily per-account
threshold it throttles into a slower queue instead of charging. That is a
different billing model for the same picture, not a cheaper price, which is why
it lives in `unlimited_entitlements` rather than as a zero row in
`model_prices`. A zero price would say "this costs nothing"; a grant says "this
account may run this, N times a day, unmetered".

Today: **Nano Banana Pro and Nano Banana 2, free on tier 3 (Studio and
Creator), 50 a day per account.**

The grant sits one tier above the model's own `minTier` of 2 on purpose, and
the gap is the point: tier 1 cannot reach Nano Banana at all, **tier 2 reaches
it and pays**, tier 3 gets it free. Close that gap and nobody who can use the
model ever pays for it — the grant would stop being a reason to upgrade and
become a write-off of the revenue line.

What a UI needs to know:

- **The same variant is served by two providers and the customer never sees
  that.** `GET /catalog` returns exactly one Nano Banana Pro. The second
  provider's row exists in `provider_models` but carries no `variant` in its
  capabilities, and the catalogue query excludes rows without one — otherwise
  the model would render twice and half the picks would be wrong.
- **Past the daily allowance the customer is charged, not refused.** The quote
  simply comes back with the normal price and no `unlimited` block. "You have
  had your fifty free, this one costs four coins" needs no new UI to say.
- **The daily counter resets at midnight Tehran time**, not UTC. A UTC reset
  lands at 03:30 local, which would hand someone a second allowance mid-evening
  and none the next.
- **Free does not mean instant.** The upstream pool is roughly six concurrent
  generations for the entire customer base, so a free generation may queue. It
  is never charged for waiting.

## Pricing

Prices live in `model_prices`, one row per (model, feature, **selector**) —
the selector being just the settings a price is keyed on, like
`{"resolution":"1080p"}`. 117 rows cover the catalogue.

Three things a UI needs to know:

- **The server prices, not the browser.** `PostgresPricingRepository.priceFor()`
  resolves the row in force _now_ and computes the amount. A quote written from
  a number the client sent is a number the client can edit, so once
  `POST /generation/quotes` lands, that is where the price comes from.
- **"Not offered" is its own answer.** A row can say a combination is not sold —
  Hailuo 2.3 has no 1080P at 10 seconds. That is `not_offered`, and it is
  different from "no price found", which is a bug. The UI disables the button on
  the first and should shout about the second.
- **Prices are effective-dated.** Changing one closes the old row and opens a
  new one rather than overwriting, so a job can always say what it was charged
  and why. `priceFor({ at })` re-prices as of any moment.

Until the quote route exists, the screens that must show a price before
submitting read `src/data/pricing.rows.json` — the same committed list the
database is seeded from, through the same resolver in `@vgen/core`. So the
number under the Create button and the number the ledger charges cannot drift.
When the quote route lands, those screens ask the server and that file stops
being read by the browser.

**Do not hand-edit `pricing.rows.json` or `pricing.expected.json`.** The first
is the price list; the second is every price the app charged before pricing
moved into Postgres, frozen so `pnpm check:pricing` can prove none of them
moved. CI runs that check over all 738 of them.

## Not built yet

So you can tell a gap from a bug:

- **Anywhere to see a finished generation.** The worker runs jobs and files
  their outputs as `assets` rows, but those rows point at the provider's own
  URLs, which expire — `storage_provider = 'external'` is what marks them — and
  there is no `GET /gallery` to read them back. That is the next phase: a
  storage adapter, reference uploads, and signed expiring read URLs.
- **useapi, so unlimited generation cannot actually generate.** A tier-3
  customer is quoted free, the submission succeeds, and the job then fails with
  `provider_unavailable` and a full refund of the day's allowance. Nothing is
  charged and nothing is lost, but nothing is produced either. Needs a token
  and a spike — see "KIE is wired; useapi is not" above.
- **`GET /catalog` does not say which OAuth providers are configured.** Each is
  registered server-side only when its credentials are set, and nothing the
  browser can read says which — so a button for an unconfigured provider
  navigates into a 404.
- **Gallery.** No server route. Demo mode returns an empty page.
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
