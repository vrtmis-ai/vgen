# Backend API

What the server actually serves today, and how the web tier reaches it. Written
for whoever is building UI against it — including agents, which is why every
claim here names the file it can be checked against.

**Maintained by the backend owner.** If it disagrees with the code, the code is
right and this file is a bug — say so.

Last verified against `main` on 2026-08-19 (`6be5c5b`), plus the assets and gallery work on `feat/assets-and-gallery`.

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

Every call the frontend makes now has a route, and every adapter reaches it.
That was not true until this change: three generation calls were pointing at
paths the API does not serve, in a job shape no server ever sent, and the
gallery had no route at all.

| `AppServices` call         | Frontend requests                                  | Server route          | Status   |
| -------------------------- | -------------------------------------------------- | --------------------- | -------- |
| `session.getCurrent()`     | `GET /session`                                     | `routes/session.ts`   | **Live** |
| `auth.*` (5 methods)       | `POST /auth/*`                                     | `routes/auth.ts`      | **Live** |
| `catalog.list()`           | `GET /catalog`                                     | `routes/catalog.ts`   | **Live** |
| `content.list()`           | `GET /content`                                     | `routes/content.ts`   | **Live** |
| `community.list()`         | `GET /community`                                   | `routes/community.ts` | **Live** |
| `community.share()`        | `POST /community`                                  | `routes/community.ts` | **Live** |
| `plans.list()`             | `GET /plans`                                       | `routes/plans.ts`     | **Live** |
| `wallet.getCurrent()`      | `GET /wallet`                                      | `routes/wallet.ts`    | **Live** |
| `generation.quote()`       | `POST /generation/quotes`                          | `routes/quotes.ts`    | **Live** |
| `generation.create()`      | `POST /jobs`                                       | `routes/jobs.ts`      | **Live** |
| `generation.getJob()`      | `GET /generation/jobs/:id`                         | `routes/jobs.ts`      | **Live** |
| `generation.downloadUrl()` | `GET /generation/jobs/:id/outputs/:index/download` | `routes/jobs.ts`      | **Live** |
| `generation.references()`  | `GET /generation/jobs/:id/references`              | `routes/jobs.ts`      | **Live** |
| `generation.remove()`      | `DELETE /generation/jobs/:id`                      | `routes/jobs.ts`      | **Live** |
| `generation.cancel()`      | `POST /generation/jobs/:id/cancel`                 | `routes/jobs.ts`      | **Live** |
| `gallery.list()`           | `GET /gallery`                                     | `routes/gallery.ts`   | **Live** |
| `assets.upload()`          | `POST /assets`                                     | `routes/assets.ts`    | **Live** |
| `campaign.getActive()`     | `GET /campaigns/active`                            | `routes/campaigns.ts` | **Live** |
| `payment.createOrder()`    | `POST /payments/orders`                            | `routes/payments.ts`  | **Live** |

So `production` mode is complete end to end: sign in, browse the catalogue, see
a price, submit a generation, watch it run, and see the file it produced. The
last two rows were 404s until 0026; both answer now.

One qualification on the second, and it is a real one: `gatewayUrl` is still
`null` on every reply, because no gateway has been chosen. The order is priced
and recorded, and the sheet stops on a neutral notice rather than navigating —
which is exactly what the contract has always said `null` means, and not a
half-built route. Choosing between ZarinPal, IDPay, NextPay and Zibal is the
remaining decision; the registration call then goes between the insert and the
reply and nothing else changes.
**In `demo` mode everything still works**, and demo mode now speaks the same
vocabulary — a finished job is `succeeded`, not `done`, because that is the word
the database uses and therefore the word that comes over the wire.

Three shapes collapsed into one to get here. `POST /jobs`,
`GET /generation/jobs/:id` and an item in the gallery are all the same
`GenerationJobSchema`: **a gallery item is a job.** There was never a second
concept, only a second schema, and the browser's copy had drifted far enough
that it required `outputAssetIds` and a status called `done` — so renaming a
path would only have traded a 404 for a parse error.

`catalog.list()` used to carry a caveat here — the route was live but the tables
were empty. That is fixed: all 19 families and 44 variants are in Postgres, and
the two modes now serve the same bytes (see below).

The contracts are mirrored, not shared: `packages/contracts/src/generation.ts`
is what the server sends and `src/runtime/contracts/generation.ts` is what the
browser accepts. A copy rather than an import on purpose — the day the two stop
agreeing, the parse fails loudly instead of a screen rendering a field that
quietly changed meaning.

## Live endpoints

Base path is `/api/v1`. Every response is JSON. Session comes from an HttpOnly
cookie, so the browser sends it automatically; the HTTP client sets
`credentials: "include"`.

### `GET /session`

Who, if anyone, is signed in, and how anyone could sign in. Never 401s —
anonymous is a normal answer.

```jsonc
{ "status": "anonymous", "host": "web", "authProviders": ["google"], "phoneSignIn": false }
// or
{ "status": "authed", "host": "web", "authProviders": ["google", "microsoft"], "phoneSignIn": true,
  "user": { "id": "…", "methods": ["email"], "emailNormalized": "a@b.c",
            "displayName": "…", "locale": "fa", "isTeam": false } }
```

Schema: `SessionSchema` in `src/runtime/contracts/session.ts`.

**`authProviders` is the list of social sign-ins this deployment actually has,
and a screen must filter against it rather than rendering both buttons.** Each
provider is registered only when its credentials are set, so an unconfigured
one has no endpoint at all — and a button for it used to navigate into a 404
_after_ the person had already committed to it.

It is derived inside `createApp` from the same object that decides whether to
register the routes, so the list and the routes cannot disagree. Three things
follow:

- **It rides on the session, not on the catalogue.** `GET /catalog` is exported
  to a committed snapshot that CI diffs, so it can never carry a value that
  depends on which environment variables a server happens to hold — demo mode's
  copy would be wrong by construction.
- **The browser's schema defaults it to empty**, not to every provider. A server
  that does not send the field yet shows no social buttons, which is the safe
  way to be wrong: never draw a door we cannot prove exists.
- **It is on the anonymous arm too**, which is the arm that matters — the only
  people who need it are the ones who have not signed in.

Locally neither is configured, so the list is `[]`. That is correct, not a bug:
**neither Google nor Microsoft is dependably reachable from Iran without a VPN**,
so phone OTP is the route most people will take once it exists.

**`phoneSignIn` is the same rule for the phone form.** It is true only when
`KAVENEGAR_API_KEY` and `KAVENEGAR_TEMPLATE` are both set. Without them the
screen offers email and password only, and `POST /auth/otp/start` and
`/auth/otp/verify` answer `404 phone_unavailable`. That is every environment
until eNamad clears, because Kavenegar will not send OTP templates for a site
without it. There is no console fallback any more, so local matches production.
Phone signup is also the only thing that grants the 12-coin trial; until it is
back, give invitees coins through the invite code's gift.

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
`image_to_video`, `video_edit`, `speech_generate`, `music_generate`,
`sound_generate`. A screen mostly does not need
it, but it is the honest way to answer "is this thing a generator or an
editor?", and it is what a job gets filed under. It is required, so it is always
there.

Two consequences worth knowing, because neither is guessable from the family:

- `topaz` is an `image` family whose second variant, `topaz-video-upscale`, is
  `video_edit`. A family's `kind` is not its variants' modality.
- Both `hailuo` variants are `image_to_video` — there is no text-only path
  through them, and their `image_url` slot is `required: true`. Their neighbours
  in `kling` and `wan` are `video_generate` and take an image optionally.
- `suno` (`music_generate`) and `suno-sounds` (`sound_generate`) answer one
  request with two takes, so a finished job's `outputs` holds two audio files.
  Read all of them: the first is not the only thing that was paid for.

**Where it comes from.** `provider_models`, grouped by the `family` column, with
everything a screen renders in `capabilities`. Not a table of frozen JSON
documents any more — the rows the router and the pricing tables already point
at. A change to `src/data/models.ts` reaches the API through
`pnpm catalog:publish`, which is idempotent; the version string derives from the
newest row's `updated_at`, so it changes exactly when the catalog does.

**What it deliberately does not carry.** No upstream endpoint. `variant.model`
and `variant.modelWithRefs` — the exact strings our supplier expects — used to
ride along in every response, and this route needs no session, so they were
public to anyone with curl. They now live only in `src/data/upstream.json`,
which the seeders read and which an ESLint rule forbids `src/**` and `app/**`
from importing. `CatalogVariantSchema` no longer declares either field, so a
`provider_models` row written before the change still parses — Zod drops what it
does not declare — and an integration test pins that.

Model _names_ are not the secret. "Veo 3.1" and "Kling" are what the customer is
buying and stay visible; who we buy them through, at what path, and for how much
does not.

**Demo mode serves the same document.** `src/data/catalog.snapshot.json` is
generated out of Postgres by `pnpm catalog:snapshot` and committed, and demo
mode reads it instead of importing `FAMILIES`. Two CI checks pin it: a unit test
that the committed file equals `FAMILIES`, and a database job that reseeds,
re-exports, and diffs. So a screen built against demo mode is built against what
production actually sends — which is the claim demo mode has to keep.

### `GET /content`

Everything the product shows that is not a model and not a price: presets, the
prompt bank, skills, the featured shelf, courses, explore examples and the
ElevenLabs voice list. Seven collections that were TypeScript arrays under
`src/data` until migration 0020.

```jsonc
{
  "version": "content-…",
  "publishedAt": 1234567890,
  "flags": { "siteBanner": true, "earlyAccess": true },
  "presets": [],
  "fragments": [],
  "skills": [],
  "featured": [],
  "courses": [],
  "examples": [],
  "voices": [],
}
```

Schema: `ContentSnapshotSchema` in `src/runtime/contracts/content.ts`.

**Seven arrays, not one tagged list.** They share one table — `content_items`,
discriminated by `kind` — because an admin thinks about them the same way:
publish it, order it, pull it. They arrive split because a screen that wants
courses should get courses rather than a filter it has to write.

**No `status` and no `order` on any item, and that is the point.** The route
serves published rows already in the admin's order. `src/data/content.ts`
exported a `published()` helper that eleven screens had to remember to call, and
a screen that forgot showed a draft to a customer. The filter is a `WHERE`
clause now, so there is nothing left to forget. CI asserts the property
directly: the served snapshot must hold exactly as many items as the table holds
published rows.

**Public.** The landing page's feature bento renders nine effects, three courses
and a voice count to a visitor with no session.

**Where it comes from.** `content_items`. Effects, courses and the prompt bank
are edited at `/admin/content` (see Admin). `pnpm content:publish` seeds from
`src/data/content.rows.json` and is **insert-only**: it runs on every deploy,
and an upsert would put the file's title and prompt back over an admin's edit.
A changed row in that file reaches a fresh database only.

**Uploaded covers and lessons** are items' `coverUrl`, `cover.url` and
`videoUrl`, stored as `/api/v1/content/media/<uuid>.<ext>` — relative, so the
same row works on any host; the browser resolves it against
`NEXT_PUBLIC_API_BASE_URL`. `GET /content/media/:file` answers **302** to a
freshly signed URL on the files host, cached for 30 minutes of the signature's 60. The bucket stays private: the route only signs keys under `content/`, and
only names the upload route issued, so it cannot be pointed at a customer's
generation. Anything else is **404**.

**`flags` is here because of first paint, not because it is content.** The
layout already blocks on this route for every visitor including anonymous ones,
so a switch that has to be known before anything is painted costs no extra
request and no flash of something that should have been off. A route of its own
would answer after the first render, and the banner would appear and then
vanish — worse than either state.

- **`siteBanner` defaults to `true`.** An absent or deleted row means nobody has
  turned it off. That is the opposite of how `early_access` reads a missing row,
  deliberately: the invite gate gets to fail closed because it guards who may
  sign up, while a banner failing closed would silently stop advertising a live
  campaign.
- **Toggled at `PATCH /admin/site-banner`** under `flags.write`, audited as
  `site_banner.changed`. `GET /admin/site-banner` reads it under the same
  permission — there is no `flags.read`, and inventing one for a value already
  public on this route would be ceremony.
- **`earlyAccess` is `feature_flags.early_access`**, the same row signup reads,
  and it defaults to `true` the way signup does. While it is on, the app layout
  shows a visitor who is not signed in the invite page on every route instead of
  the product; `/signin`, `/signup` and the legal pages sit outside that layout
  and stay reachable. Toggled at `PATCH /admin/early-access`. It is in this
  document's fingerprint, so the switch reaches the next request rather than the
  next content publish. Demo mode supplies `false`.
- **It is not in `content.snapshot.json`.** A flag is a runtime switch whose
  value at export time says nothing about its value now, so freezing one into a
  fixture would only mislead. Demo mode supplies `true`, the same default the
  server applies. `version` and `publishedAt` are left out for their own
  reasons; the CI check that counts served rows sums `.length` over every key it
  finds, so a non-array top-level entry would quietly make it `NaN`.

**Demo mode serves the same document**, from `src/data/content.snapshot.json`,
generated by `pnpm content:snapshot` and diffed in CI.

### `GET /community`

The feed of creations users published into the app.

```jsonc
{
  "posts": [
    {
      "id": "…",
      "author": "reza.vfx",
      "kind": "video",
      "familyId": "seedance",
      "prompt": "…",
      "seed": "…",
      "w": 16,
      "h": 9,
      "likes": 1284,
    },
  ],
}
```

Schema: `CommunityFeedSchema` in `src/runtime/contracts/community.ts`.

**Not in `content_items`.** A post is a moderated user submission with an owner,
a consent record and a moderation state, and `posts` has modelled all three
since 0001. Editorial content and a user's submission are different things.

**Three filters, not one.** `status = 'approved'` is the moderator's decision,
`deleted_at is null` is the author's, and `consent_at is not null` is the
author's agreement to expose the prompt and settings at all. A post can pass the
first two and fail the third — approving something never creates consent.

**No `status` and no author user id.** Only approved posts are served, so
`status` could never read anything else; and a display handle is all a card
needs, while shipping an internal id to every visitor would turn a public feed
into an enumeration of the user table.

> **Every author in the seeded feed is fake.** Ten users written by
> `pnpm community:publish`, each with an `@demo.invalid` address — a domain
> reserved by RFC 2606 that can never be registered, so none of them can reach
> an inbox or collide with a real signup. They carry no password hash and no
> phone. Remove the whole set with
> `delete from users where email like '%@demo.invalid'`. CI asserts that every
> seeded post's author matches that predicate.

**Migration 0021** added three columns a post could not reach through its job:
`consent_at` (§14, taken at share time, never backfillable), `kind` (a reel is
assembled outside the app and has no single job to infer a type from) and
`family_code` (reels have no one job to ask, and jobs age out while posts do
not).

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

| Route                                              |                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `POST /auth/otp/start`                             | `{ phone }` → `202 { sent: true, expiresAt }`. The route most Iranian users take  |
| `POST /auth/otp/verify`                            | `{ phone, code, inviteCode?, deviceFingerprint? }` → session cookie               |
| `POST /auth/register`                              | `{ email, password, inviteCode?, deviceFingerprint? }` → `201`                    |
| `POST /auth/invite/check`                          | `{ code }` → `200 { valid }`, one boolean for every refusal; 20 per 15 min per IP |
| `POST /auth/login`                                 | `{ email, password }` → `200`                                                     |
| `POST /auth/logout`                                | → `204`, always, and says nothing about whether a session existed                 |
| `GET /auth/google` · `/auth/google/callback`       | Registered only when Google credentials are configured                            |
| `GET /auth/microsoft` · `/auth/microsoft/callback` | Registered only when Microsoft credentials are configured                         |

Schemas: `packages/contracts/src/auth.ts`. They are `.strict()`, so an extra key
is a `validation_failed`, not an ignored field.

Things a UI needs to know about these:

- **Phone numbers are accepted as typed** — `0912…`, `+98912…`, `98912…`,
  Persian digits — and normalised server-side. Do not pre-format them; two
  spellings of one number must not become two accounts.
- **Early access is on.** Signup without an invite code answers
  `403 invite_required`. A bad or revoked code answers `400 invite_invalid`,
  with the same message whichever rule refused it — unknown, revoked, expired,
  not started and used up are indistinguishable from outside.
- **The invite page asks `POST /auth/invite/check` first**, so a mistyped code
  is refused before anyone reaches a phone number. It is a hint, not the gate:
  signup checks the code again in the transaction that creates the account, so
  a code that runs out between the two is still refused. A failed signup does
  not spend a seat.
  Signing in to an existing account never needs one. The invite page hands a
  code to `/signup?invite=<code>`, which arrives with the field filled in.
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
- **An invite rides a social sign-in as `?invite=<code>`** on `/auth/google` or
  `/auth/microsoft`. It is held in an HttpOnly cookie beside the state for the
  ten minutes the provider round trip may take, handed to the same gated signup
  the other routes use, and cleared on the way back. A start without `invite`
  clears any earlier one.
- **Both provider routes spend the per-IP login budget** (50 per 15 minutes).
  Over it, the browser is sent to `?auth=oauth_failed` rather than a JSON 429 it
  could not render mid-navigation.
- **A failed social sign-in comes back as `?auth=<code>` on the landing page**,
  not as a JSON error — there is no response to read when the browser is
  mid-redirect. Expect `oauth_failed`, `invite_required`, `invite_invalid` or
  `account_suspended`, and `failed` for a CSRF-state mismatch.
  `OAuthFailureNotice` reads it on the landing page and on the invite page.
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

`/api/v1/admin/*` — invite and discount CRUD, per-code usage and spend, the
early-access switch, and **providers and model routing**.

**Every new invite code needs a cap and an expiry.** `POST /admin/invites`
refuses a body without `maxRedemptions` or with an `expiresAt` that is not in
the future. `PATCH /admin/invites/:id` (`invites.write`) changes `label`,
`maxRedemptions` and `expiresAt` and nothing else; a past `expiresAt` closes the
code at once, and a cap below the number of people already admitted answers
`409 limit_below_used`. Each edit is audited as `invite.updated` with before and
after. The list carries `expiresAt`, `startsAt`, `maxRedemptions` and
`redemptionCount`, and `isUsable` now also respects `starts_at` (migration 0031).

**The panel is at `/admin`** (`src/screens/admin/`), outside the `(app)` route
group because that group's layout gates on a _customer_ session and will not
paint until the wallet, catalogue and content have loaded — none of which a
staff session has or needs. It replaced a local-storage panel that had never
called this API.

Not a normal frontend surface: it needs a staff role, a separate cookie
(`deev_admin`, never the customer one) and a confirmed second factor. **Sign-in
is two steps and the session authorises nothing between them.**

### `GET /admin/session`

What the panel asks before it renders anything.

```jsonc
{ "status": "authed" | "mfa_required", "email": "…", "roles": ["admin"], "permissions": ["*"] }
```

**404 is the signed-out answer, not an error.** The whole staff surface answers
404 to anyone without a session so its existence is not confirmed to a customer
poking at the URL — which means an expired staff cookie and a stranger are
indistinguishable from outside, and a client must treat 404 here as "sign in"
rather than as a failure.

**`permissions` is empty while `status` is `mfa_required`.** So a client can
render straight off that array without also checking the status, and a
half-authenticated session cannot draw a section it would be refused from.

This is the one admin route deliberately **not** behind the permission gate: it
has to answer before a second factor lands, or a reload during sign-in could not
resume where the session actually is. It discloses nothing a holder of the
cookie does not already have.

### Signing in

1. `POST /admin/session` `{email, password}` → **202** `{status:"mfa_required"}`
   and a cookie that authorises nothing. Answers 404 for a wrong password, an
   unknown address _and_ a real customer's address — it must not reveal who is
   staff. 403 `mfa_not_enrolled` if the account has no second factor: there is
   no "just this once".
2. `POST /admin/session/mfa` `{code}` → **200** `{status:"authed", roles, permissions}`.
   A failure is audited as `admin.mfa.failed`.
3. `DELETE /admin/session` → 204.

Every mutation on this surface writes an `audit_log` row before it answers, and
that table is append-only at the database, so the record cannot be tidied
afterwards by the person who made it.

Two clocks run on a staff session. **Twelve hours** is the ceiling, and
**ninety minutes** is how long one may sit untouched — `last_used_at` has been
stamped on every request since migration 0012 and was consulted by nothing,
which meant a panel left open on a machine somebody walked away from stayed
usable for the full twelve.

The staff cookie is **`SameSite=Strict`**, unlike the customer one. Nothing
navigates cross-site into `/admin` — no OAuth return, no email link, no payment
callback — so Strict costs nothing there and removes the class of request where
another site causes a browser to send a staff session somewhere. `deev_session`
stays `Lax` because the Google callback genuinely is such a navigation and
Strict would drop it exactly on arrival.

### Open staff sessions

| route                        | permission       | does                                             |
| ---------------------------- | ---------------- | ------------------------------------------------ |
| `GET /admin/sessions`        | `security.read`  | every open staff session; yours marked `current` |
| `DELETE /admin/sessions/:id` | `security.write` | end one → `{ revoked: 1 }`, or **404** if none   |
| `DELETE /admin/sessions`     | `security.write` | end all except the caller's → `{ revoked }`      |

The question this exists to answer is _is there a session open that I do not
recognise?_ Rows carry the IP, the user agent, whether the second factor was
passed, and when it was last used. **No token and no hash appears** —
`admin_sessions` stores only a hash of the token and the query never selects
it.

Your own session is marked rather than hidden: it is the one row a person can
definitely identify, which is what makes the others legible. Ending it is
allowed and clears the cookie in the same response.

### Providers and routing

The answer to _"which provider, and which of their models, actually runs this
thing we sell?"_ — and the ability to change it without a deploy.

| route                             | permission      | does                                                                                           |
| --------------------------------- | --------------- | ---------------------------------------------------------------------------------------------- |
| `GET /admin/providers`            | `catalog.read`  | providers, their credential pool, whether an adapter exists, whether the key is set            |
| `POST /admin/providers`           | `catalog.write` | add one → **201**. `{ code, name, baseUrl?, secretRef, creditUnitName?, unitCostUsd? }`        |
| `PATCH /admin/providers/:id`      | `catalog.write` | `{ isActive?, baseUrl?, name? }`                                                               |
| `GET /admin/models`               | `catalog.read`  | every catalogue variant, where it is currently sent, its `routeTargets`, and every serving row |
| `POST /admin/serving-models`      | `catalog.write` | add a destination → **201**. `{ providerId, externalModelId, name, modality }`                 |
| `GET /admin/models/:id/routes`    | `catalog.read`  | one variant's routes, active first, then by priority                                           |
| `PUT /admin/models/:id/routes`    | `catalog.write` | **replaces** the list — the deliberate, ordered switch                                         |
| `POST /admin/models/:id/route-to` | `catalog.write` | `{ servingModelId }` — make it the winner now, in one transaction                              |
| `DELETE /admin/models/:id/routes` | `catalog.write` | back to the provider that owns the catalogue row                                               |

Three things about this are worth knowing before you build against it.

**`secret_ref` is an environment variable's name, never a key.** It is returned;
the value is not, and `configured` is the only thing derived from it. That field
separates "nobody set the key" from "the provider is down", which are the two
reasons a newly routed model fails and which look identical from a refund.

**`PUT` replaces rather than patches.** There is a partial unique index on
`(catalog_model_id, priority) where is_active`, so swapping two routes one
statement at a time collides on the priority that is only transiently taken. Send
the whole list; the write is one transaction.

**A route ships inactive and stays that way until somebody says otherwise.**
`isActive` defaults to `false` on input, and re-running the seeder never turns a
route on or off. Adding a route is not the same act as moving traffic onto it.

**`routeTargets` is the list a picker must be built from.** It holds every
destination _declared_ for that variant — its `model_routes` rows, active or
not, plus its `unlimited_entitlements` pairing, which 0018 defines as "a second
provider's copy of the same logical model". It is usually empty, and an empty
list is the true answer: most models have nowhere else to go.

Each entry carries `providerCode`, `externalModelId`, `priority`, `isActive`
and `source`, ordered lowest priority first — the order the runner reads them,
so the first active `route` entry is the one that would serve a job submitted
now. `source` separates a `route` (a routing preference, ranked) from an
`entitlement` (where unlimited subscribers are served free, `priority: null`).
The null is the honest answer rather than a missing number, and a client that
renders it as "priority —" without saying which kind it is invites somebody to
go looking for the rank.

The temptation is to skip it and filter `servingModels` by modality instead.
That is what the panel did, and it was wrong in a way that does not announce
itself: it offered `wavespeed-ai/qwen-image/text-to-image` as somewhere to send
Nano Banana Pro. Both make images and that is the entire overlap. Nothing would
have failed — the job would have run, returned a picture, and charged Nano
Banana Pro's price for a Qwen one. Whether a provider hosts a given model is a
fact about that provider, no column in this schema knows it, and a person has to
assert it before it can be offered. `PUT /routes` and `POST /admin/serving-models`
are where the assertion is made.

**There are two ways to switch, for two situations.** `PUT /routes` takes the
whole ordered list and is how you decide a ranking in advance — several
destinations, most of them parked. `POST /route-to` takes one id and is how you
move something while a provider is failing: the server stands down whatever was
winning and switches the chosen route on, in one transaction. It deliberately
does **not** accept a priority — two admins each computing one against a list
that moved underneath them is the race the single statement removes.

`route-to` never rewrites an existing route's `param_overrides`. The seeded
WaveSpeed routes carry the translations that make them work at all — qwen's
`aspect_ratio` becoming `size`, with `16:9` remapped to `1344*768` — and
resetting those would post KIE's vocabulary at a provider that does not speak
it.

**A destination is not a product.** `POST /admin/serving-models` writes a
`provider_models` row with empty `capabilities`, and the schema is `.strict()`,
so a caller naming `capabilities` gets a 400 rather than a silently dropped
field. `catalogRepository` decides what is in the shop by testing
`capabilities ? 'variant'`; a destination able to carry that key would be a
destination a customer could buy.

**`secretRef` refuses the `NEXT_PUBLIC_` prefix.** Next inlines anything
carrying it into the browser bundle at build time and this repository is public,
so a key named that way would be published rather than leaked. `POST
/admin/providers` answers 400. A duplicate provider code or model id answers
**409** `conflict` — creation is not idempotent, because silently updating the
existing `kie` row would change a provider's base URL with nobody having decided
to.

### Analytics, and the customer list

Read live out of Postgres. `usage_daily` exists in the schema for a nightly
rollup that nothing has ever written to; with almost no rows yet, scanning the
real tables is correct to the second and is less machinery. That table is the
upgrade path, and one of these queries getting slow is the signal to take it.

| route                                 | permission                      | does                                         |
| ------------------------------------- | ------------------------------- | -------------------------------------------- |
| `GET /admin/analytics/overview`       | `analytics.read`                | KPIs, standing totals, and a per-day series  |
| `GET /admin/analytics/models`         | `analytics.read`                | jobs, coins, cost and failure rate per model |
| `GET /admin/analytics/providers`      | `analytics.read`                | attempts, failures and latency per provider  |
| `GET /admin/users`                    | `analytics.read` + `users.read` | paginated, searchable customer list          |
| `GET /admin/users/:id`                | `analytics.read` + `users.read` | one customer, recent jobs, ledger, live bans |
| `POST /admin/users/:id/credits`       | `credits.grant`                 | `{ coins, note }` — signed; note required    |
| `POST /admin/users/:id/bans`          | `users.write`                   | `{ scope, reason?, expiresAt? }` → **201**   |
| `DELETE /admin/users/:id/bans/:banId` | `users.write`                   | lift one ban                                 |
| `DELETE /admin/users/:id/sessions`    | `users.write`                   | end every customer session → `{ revoked }`   |

All take `?window=today|7d|30d|all`, defaulting to `30d`. An unknown window is a
400 rather than a silent fallback.

**Two permissions on the customer list, deliberately.** Aggregates need
`analytics.read`. The list carries every customer's email beside what they
spent, so it additionally needs `users.read` — which is what makes it possible
to hand somebody the money dashboard without also handing them the mailing list.
That refusal is a **403**, not the surface's usual 404: the caller demonstrably
has a staff session, and denying the route exists would be a lie told to
somebody already inside.

**A day means a Tehran day.** The server is UTC, where midnight falls at 03:30
Tehran, so a UTC boundary would split one evening's session across two days and
make "today" wrong for every operator reading it. Same reasoning as the
free-tier reset in `0018_unlimited_access.sql`.

**Coins are usage; money is separate.** `coinsSold` comes from
`credit_lots.source = 'purchase'` — _not_ from a ledger `entry_type`, because
`grant_credits` writes every arrival as `grant` whatever its origin, and reading
entry_type there returns zero for everything. Revenue is `orders`, in Rial.
`grossMarginUsd` is **null** while nothing has been sold rather than a large
negative number, which would read as a business losing money instead of one that
has not opened.

**Adjustments go through `adjust_credits`.** Positive delegates to
`grant_credits`, so it becomes a real lot that expires and reconciles like any
other. Negative consumes lots FIFO and **refuses to overdraw rather than
clamping** — that refusal surfaces as **409** `insufficient_credits`. The note
is required: `credit_ledger` is append-only at the database, so an unexplained
entry is a permanent mystery.

**A ban does not stop sign-in.** `generation` and `platform` refuse new jobs
with **403** `banned` at `POST /jobs`; `explore` and `platform` are meant to
refuse publishing. Someone who paid for generations keeps access to the ones
they already have.

**`explore` and `platform` bans refuse `POST /api/v1/community`** with **403**
`banned`, checked before the job is read. That is the only thing they refuse:
the account keeps signing in and keeps generating, because it paid for that.

### `POST /community`

Share a finished generation into the feed. Authenticated, unlike the `GET`
beside it — a post carries an account's name on it for as long as it exists.

```jsonc
// request
{
  "jobId": "…",
  "consent": true, // required, and `true` is the only accepted value
  "caption": "sunset no. 4", // optional
  "promptVisible": true, // optional, defaults true
}
```

```jsonc
// 202
{ "id": "…", "status": "pending" }
```

Schema: `SharePostRequestSchema` / `SharedPostSchema` in
`packages/contracts/src/community.ts`.

**202, not 201.** The post exists and the feed does not have it. A `201` would
send the author to look for something that is not there, which reads as a bug
rather than as a queue. Nothing on this route publishes; a moderator does, at
`POST /admin/community/pending/:id`.

**`consent` is `z.literal(true)`.** §14 requires the author's agreement to
expose the prompt, the settings and any reference files, taken **at share
time**. A default would make an omitted field mean yes, which is the one
reading of silence that is not available here. `consent_at` is stamped on the
row and is never backfilled — see migration 0021.

**The caller names a job and nothing else about the post.** The author, the
account, the model family and the cover picture are all read from that job. A
request that could name its own `familyId` could file a post under a model that
never ran it; one that could name its own author could publish as somebody
else.

**`promptVisible: false` does not fall back to the prompt.** The feed draws
`caption` as the post's `prompt`, so an empty caption from someone who withheld
the recipe would publish the very thing they withheld. That combination is
refused with `nothing_to_show` instead.

| Outcome           | Status  | When                                                              |
| ----------------- | ------- | ----------------------------------------------------------------- |
| shared            | **202** | Queued for moderation.                                            |
| `banned`          | **403** | An `explore` or `platform` ban. Bars publishing and nothing else. |
| `unknown_job`     | **404** | No such job **or** it is not on this account.                     |
| `already_shared`  | **409** | One live post per generation — `posts_one_per_job_idx`, 0024.     |
| `not_finished`    | **409** | The job has not succeeded.                                        |
| `nothing_to_show` | **409** | Audio, deleted outputs, or a withheld prompt with no caption.     |

**Somebody else's job is `unknown_job`, not a refusal.** Confirming that an id
exists but belongs to another account would make this route a way of
discovering job ids by guessing them.

**Sharing twice is one post.** Migration 0024 adds a unique index on `job_id`,
partial on `job_id IS NOT NULL` (the seeded demo posts have no job and would
otherwise collide with one another) and on `deleted_at IS NULL` (deleting a post
releases the job, or an author who removes something could never share it
again). A double-tapped button and a client retrying after a timeout both land
on it, and both get `already_shared`.

> **An approved post still will not appear in the feed.** `GET /community`
> draws each card from a placeholder art key on the cover asset — the picsum
> stand-in `pnpm community:publish` writes — and a real rendered output does not
> carry one. Closing that means being able to serve a customer's file to a
> browser, which nothing here does yet: there is no asset read route, the object
> store is deliberately unreachable from a browser, and a **public** feed means
> deciding what a public asset URL may expose. That is a privacy decision rather
> than a missing function, so this route stops short of it. The gap is asserted
> in `communitySubmissions.integration.test.ts` rather than left to be found.

### `GET /admin/community/pending` · `POST /admin/community/pending/:id`

The moderation queue, and the other half of `POST /community`. Permissions
`community.read` and `community.write`; the seeded `admin` role holds `*` and so
has both already.

```jsonc
// GET → 200
{ "posts": [{ "id": "…", "author": "reza.vfx", "kind": "image", "familyId": "flux",
              "caption": "…", "prompt": "…", "promptVisible": false, "submittedAt": 0 }] }

// POST { "decision": "approve" } → 200
{ "id": "…", "status": "approved" }
```

**The queue carries the prompt whether or not the feed may show it.** A
moderator deciding whether something may be published has to see what made it,
and that is exactly what the public feed must not hand out. It is the reason
these are separate repositories rather than one with a flag.

**Deciding is `where status = 'pending'`, not `where id = …`.** Two moderators
reaching the same row would otherwise each be told theirs was the decision, and
`audit_log` would hold two entries that disagree. The second one gets **404**
`not_pending`, which also covers "no such post" — the answer is the same either
way, and so is the fix: re-read the queue.

Both decisions are audited as `community.post.approve` / `community.post.reject`,
with the rejection reason in `after`. Approving is a decision to show one
person's work, and their prompt, to everyone who opens the site.

### `POST /community/posts/:id/report`

Reports a published post. Authenticated.

```jsonc
// { "category": "illegal", "note": "…" } → 200
{ "id": "…", "reported": true }
```

**A report hides nothing.** One that un-publishes on its own is a heckler's veto
with a single click, and the first use anybody finds for one is aiming it at a
competitor. What this does is put the post in front of a person, who has
`DELETE /admin/community/posts/:id` to act with.

Authenticated so a report is attributable, and **one per person per post** —
enforced by a unique constraint, because otherwise the count measures how
determined one reporter is rather than how many people objected, and the queue
is sorted by exactly that number. A repeat answers **200** as well: the second
press of a button is somebody who is not sure the first one worked.

Only a published post can be reported. A pending one is already in front of a
moderator, and **404** is the same answer for "not published" and "does not
exist" — which is what a stranger should hear about either.

### `GET /admin/community/reports` · `POST /admin/community/reports/:id/resolve`

What people have complained about, busiest first. Permissions `community.read`
and `community.write`.

```jsonc
// GET → 200
{ "reported": [{ "postId": "…", "caption": "…", "prompt": "…", "author": "…",
                 "reports": 3, "categories": ["illegal"], "firstReportedAt": 0 }] }

// POST → 200
{ "id": "…", "resolved": 3 }
```

A read over `post_reports` rather than a second status on `posts`: flipping an
approved post back to `pending` would un-publish it on somebody's say-so, which
is the veto again by another name.

Resolving marks the open reports as looked at **whatever was decided**. A report
read and dismissed is resolved as much as one acted on — the outcome lives in
the audit entry and in whether the post is still visible. Without it the queue
only ever grows, and a queue that only grows stops being read. Audited as
`community.reports.resolved`.

### `DELETE /admin/community/posts/:id`

Pulls a published post down. Permission `community.write`. Body is required:

```jsonc
// { "reason": "court order 1404/123" } → 200
{ "id": "…", "visible": false }
```

**The reason is required, where a rejection's is optional.** A rejection happens
inside a queue whose whole context is the decision being made. A takedown
happens to something the public has already seen, possibly months later and
possibly because somebody outside the company asked — and a removal with no
recorded ground is indistinguishable from an accident by then.

Soft, like every other removal here: `posts.deleted_at` is set and every read in
`communityRepository` already filters on it. The row stays as the evidence that
the post existed and was taken down, which is the thing an order asks you to be
able to produce.

Unlike `decide()` this matches on the post rather than on its status, so it
works on an approved post — which is the whole point. Before it existed there
was no route that set `deleted_at` at all, and complying with an order meant a
hand-written `UPDATE` against production under time pressure.

Already gone answers **404**, so a repeated call writes no second audit entry
claiming a second takedown. Audited as `community.post.takedown`.

### `GET /admin/staff` · `POST /admin/staff` · `PATCH` · `DELETE /admin/staff/:userId`

Who is staff, and what each of them can do. Permissions `staff.read` and
`staff.write`; the seeded `admin` role holds `*` and so has both.

```jsonc
// GET → 200
{
  "staff": [
    {
      "userId": "…",
      "email": "…",
      "roleCode": "moderator",
      "roleName": "Moderator",
      "permissions": ["community.read"],
      "isCustom": true,
      "hasMfa": true,
      "grantedAt": 0,
      "grantedByEmail": "…",
    },
  ],
  "grantable": ["*"],
}

// POST { "email": "…", "roleCode": "moderator", "permissions": ["community.read"] } → 201
// PATCH { "permissions": null } → 200   // null hands the role's own set back
// DELETE → 200 { "userId": "…", "revoked": true }
```

Permissions used to resolve from the role alone, so the four seeded roles were
the only four possible admins and `admin` holds `["*"]`. `user_roles.permissions`
(migration 0029) is **NULL for inherit, an array to pin** — every row written
before that column existed still resolves exactly as it did.

**Three rules, all enforced on the server.** `grantable` is sent so a form does
not offer what will be refused; it is never the control.

1. **You cannot grant what you do not hold.** Checked with `permissionsWithin`,
   and checked against the _effective_ set — naming a role whose own permissions
   exceed yours is the same escalation as listing them out. **403**
   `beyond_your_own`.
2. **You cannot touch somebody who holds what you do not.** Rule 1 stops a
   limited admin _granting_ `*` and says nothing about them taking it away from
   the person who has it. **403** `outranked`.
3. **You cannot edit yourself.** Not a security rule but a lockout rule: the
   first two permit narrowing your own set, and the result is a console nobody
   can get back into.

Appointment is **by email, and creates the account when given a `password`**
(10–512 characters) for an address nobody uses yet. Staff are made by staff, so
they need no invite code while signup is invite-only. An unknown address
without a password is **404** `no_such_user`. A password for an address that
already has an account, active or not, is **409** `account_exists` rather than
applied: otherwise `staff.write` would be a way to take over anyone's account.

The 201 carries `totp: { secret, uri }` when the person had no confirmed second
factor, and `null` otherwise. `/admin` refuses a password alone, so this is how
a new member of staff gets in: hand them the key once, and they add it to an
authenticator app. It is stored only sealed and never written to the audit log,
which records `accountCreated` and `secondFactorIssued` instead. Appointing an
existing member of staff who has no factor issues one the same way.

A permission string must match `^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?)$`.
The field is compared against every admin route in the system, and a language
rich enough to be interesting is one where a typo grants more than it reads as.

Audited as `staff.appointed`, `staff.permissions.changed` (both sides) and
`staff.revoked`.

### `GET · POST · DELETE /admin/staff/:userId/plan`

Turns a plan on for a member of staff. Permission `plans.grant` — its own, and
not `staff.write`, because it spends the company's capacity rather than
delegating authority and the people who should do one are not always the people
who should do the other. Rule 2 above applies here too.

```jsonc
// POST { "planCode": "pro" } → 201
{ "plan": { "subscriptionId": "…", "planCode": "pro", "planName": "Pro", "tier": 2,
            "coins": 500, "startsAt": 0, "endsAt": 0, "status": "active" } }

// DELETE → 200
{ "userId": "…", "revoked": true, "coinsWithdrawn": 500 }
```

**The monthly limit is not a rule this code remembers to apply — it is what a
grant is.** One term of a subscription means three rows: a `subscriptions` row,
which is what the perk tier reads; a `credit_lots` row of exactly
`plans.micro_credits_per_term`, expiring when the term does; and a
`credit_ledger` entry, because an off-ledger grant balances today and breaks the
reconciliation that proves nothing has been lost. The ceiling enforces itself —
the wallet sums lots and the hold path refuses to overdraw — so an account that
spends its term in a week cannot start another generation until the next grant.

**Granting a pack is the same call and the opposite promise.** `term_days = 0`
writes the lot with no `expires_at`, ends the subscription row at `infinity`,
and skips the "already active" refusal, because coins are not a membership to
collide with. `endsAt` comes back null on those.

This is **not** unlimited access. `unlimited_entitlements` exists for that, is
per-model, and is a different decision.

A second grant on a live plan is **409** `already_active` rather than a silent
success, with the live grant in the body: pressing the button twice must not
hand out two terms' credits. Deactivating cancels the subscription and expires
what is left of the term — leaving the credits behind would mean "deactivate"
left the account holding the month's coins. Spent credits are not clawed back.

Audited as `staff.plan.granted` / `staff.plan.revoked`.

### `GET · POST /admin/content` · `PUT · DELETE /admin/content/:id`

Effects (`preset`), academy courses (`course`) and the prompt bank
(`prompt_fragment`), edited from the panel's «افکت‌ها و آکادمی» section. The
other four collections in `GET /content` still come only from the seed file.
`content.read` lists; `content.write` does everything else. The seeded `admin`
role holds `*` and so both.

- **`GET /admin/content?kind=preset|course|prompt_fragment`** → `{ entries }`:
  every row of that kind that is not archived, drafts included, in the order
  the site shows them. Each entry is `{ id, kind, status, item }` — `id` is the
  row's uuid, `item.id` is the code the site uses (`p1`, `fx-1a2b3c4d`), and
  `item` is exactly what `GET /content` would serve. Schema:
  `ContentEntriesSchema`.
- **`POST /admin/content`** → **201** `{ entry }`. Body `{ kind, status, item }`
  (`ContentWriteSchema`), where `status` is `draft` or `published` and `item`
  is the served item without `id` and `seed` — the server gives a new row its
  code and placeholder art. New rows go first in the order.
- **`PUT /admin/content/:id`** → `{ entry }`. The same body; replaces
  everything but the code, the seed and the place in the order. The kind cannot
  change: a preset id with a course body is **404**.
- **`DELETE /admin/content/:id`** → `{ id, status: "archived" }`. **Archives**
  rather than deletes. The seeder is insert-only and runs on every deploy, so a
  hard-deleted seeded row would be inserted again; an archived one stays
  archived, and neither route lists it.

**400** `validation_failed` names the field (a prompt of spaces, a cover that
is not an http(s) link or an upload path, a title over its cap). **422**
`unknown_family` when no active model carries the chosen family — the card
would open nothing. **404** for a malformed id, an archived row, or the wrong
kind. Every write is audited as `content.create` / `content.update` /
`content.delete` with the row's code as the target.

What is saved is on the site on the next request: the public document's
fingerprint counts published rows and their newest `updated_at`.

### `POST /admin/content/media?purpose=cover|lesson`

One file, multipart, under `content.write`. → **201**
`{ url, kind: "image"|"video", byteSize }`, where `url` is
`/api/v1/content/media/<uuid>.<ext>`: the value to put in an item's `coverUrl`,
`cover.url` or a lesson's `videoUrl`. The type is read from the bytes, not
the header.

| Purpose  | Accepts                      | Limit                                                           |
| -------- | ---------------------------- | --------------------------------------------------------------- |
| `cover`  | JPEG, PNG, WebP, GIF         | 5 MB                                                            |
| `cover`  | MP4, WebM (a course's cover) | 20 MB — it autoplays on the Academy grid, so it is a short loop |
| `lesson` | MP4, WebM                    | 150 MB — about ten minutes of 720p                              |

**413** `file_too_large` over the limit, **415** `unsupported_media_type` for
anything else — a picture as a lesson, QuickTime, HTML. The limits are
`CONTENT_MEDIA_LIMITS` in the content contract, and the panel checks them
before it sends a byte. The API holds one upload in memory while it stores it,
which is the other reason for a ceiling. Audited as `content.media.upload`.

A file whose form is then cancelled stays in storage unreferenced. Nothing
links to it, so nothing serves it.

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
  "tomanPerUsd": 235854,
}
```

Schema: `PlansResponseSchema` in `packages/contracts/src/plans.ts`, mirrored for
the browser in `src/runtime/contracts/plans.ts`. Ordered the way the cards are
meant to read — do not sort it.

**This is what the UI reads.** `AppServices.plans.list()` fetches it once, the
app shell puts it in `PlansProvider`, and the plans screen, the landing page's
price cards and the access gate's padlock all read it from there. Nothing
renders a price from a file any more. Demo mode serves
`src/data/plans.snapshot.json` — the database's own export, committed and diffed
in CI — so a screen built without a backend is built against the real payload.
`plans.rows.json` beside it is the seeder's _input_; both are generated, so
**do not hand-edit either.**

Six things worth knowing:

- **Prices are USD.** The coin economy pivots on USD, so the Toman figure a
  customer sees is a conversion applied at the edge and a rate change moves one
  number instead of every plan row.
- **`tomanPerUsd` is that rate, and it changes daily.** It is the live
  `fx_rates` row (`USD`→`IRR`) over ten, and it is served here rather than
  compiled into the bundle because the screens apply it to figures the server
  cannot precompute — a campaign discount depends on the account asking. It is
  always a whole number, so the price a card rounds to the nearest thousand
  Toman and the price `POST /payments/orders` reserves round identically.
  Serving the ladder without it is a 500: a plan card with no rate renders NaN
  into a price. The worker fetches it from the market once a day — see
  `apps/worker/src/fxRefresh.ts` — so this document changes value daily and the
  memoised `PublicDocument` fingerprint includes the rate for that reason.
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

**No tier gating.** There was some, on both sides, and it is gone (owner's
decision, 2026-09-20): a family's `minTier` no longer decides who may run it.
Every model is open to every account — including one that has never bought
anything — and the only thing between a customer and a generation is whether
the wallet covers the price. `POST /generation/quotes` no longer answers
`tier_too_low`, and nothing in the browser draws a padlock.

`plans.tier` and `minTier` both remain. The tier is what the unlimited pipe
reads, through `unlimited_entitlements.min_tier`; `minTier` is how those grants
are authored and how flagship a model is described. Neither is access control.

**Two kinds of thing are sold from the `plans` table**, and `term_days` tells
them apart:

- **Packs** — Starter, Basic, Flow, Plus, the four `group: "entry"` rows —
  have `term_days = 0`. The coins they grant never expire (`credit_lots`
  written with a null `expires_at`), no membership lapses, and buying one while
  something else is live is just buying more coins. There is no monthly ceiling
  to run into, which is the whole promise.
- **Subscriptions** — Pro, Studio, Creator — keep a thirty-day term. Their
  coins expire with it, which is where the annual price gets its margin, and
  that expiry is the monthly limit: the wallet sums lots with credit remaining
  and the hold path refuses to overdraw.

**The unlimited window.** `plans.unlimited_days` is how long after a
subscription starts the free pipe is open: **7 on Pro, 30 on Studio and
Creator, 0 on every pack.** The server reads it through
`entitlementsRepository.unlimitedTierForAccount`, which answers 1 once the
window has closed even though the subscription is still live — so a closed
window reaches no entitlement and the quote comes back priced.
`GET /wallet`'s `tier` is that same number, not the plan's tier, so the free
switch leaves the dock on the day the quote stops coming back free.

### `GET /campaigns/active`

The running promotional window, or `null`. Public, like the plans it advertises.

```jsonc
{ "id": "nowruz-1405", "endsAt": 1755648000000, "maxDiscountPct": 22, "maxBonusCoins": 350 }
```

`null` is the ordinary answer and the ordinary state of the year. The strip
draws nothing for it — an absent banner is the designed appearance of the page,
not a failed fetch.

**`endsAt` is an absolute epoch-milliseconds instant and never a remaining
duration.** The strip counts down to it, prints "limited time" beside the clock,
and removes itself at zero. A duration restarts on every page load, so the
countdown never ends and the urgency next to it is false. That is the bug this
route exists to remove, and `CampaignSchema` refuses anything that is not a
plain non-negative integer.

**The two headline numbers are derived, not stored.** `maxDiscountPct` is the
largest annual saving in the plan ladder and `maxBonusCoins` the largest bonus
grant on any plan — folded from the same rows `POST /payments/orders` prices
from. On the campaign row they would be numbers somebody typed, and the first
plan repricing would make the advertisement wrong while leaving it perfectly
valid. Derived, the strip cannot promise a rate the till will refuse. If a
campaign ever needs a discount **of its own**, it becomes a column on
`campaigns` _and_ a term in the checkout pricing — never a number nothing
enforces.

**Starting one is a row**, and there is deliberately no seed:

```sql
INSERT INTO campaigns (code, name, starts_at, ends_at)
VALUES ('nowruz-1405', 'Nowruz 1405', now(), '2026-03-28 20:30+03:30');
```

`code` is what the browser receives as `id`. Two overlapping windows are refused
by an exclusion constraint rather than resolved by a tie-break, because the
strip has room for one offer and picking silently would show a customer
whichever one the planner happened to return first. Ending a campaign early is
`UPDATE campaigns SET ends_at = now()` — the same code path the countdown
already takes to zero.

### `POST /payments/orders`

Prices a plan, records the order, and says where to send the person next.
Requires a session.

```jsonc
// request
{ "planId": "pro", "cycle": "monthly" } // cycle: "monthly" | "annual"
```

```jsonc
// 201
{ "orderId": "01a0…", "amountToman": 8330000, "gatewayUrl": null }
```

**The body carries no amount, and that is the point.** If the browser sent the
figure it displayed, the sum shown and the sum charged would be two calculations
that have to agree — and the editable one would win. Extra fields are stripped
by the schema, so naming an `amountToman` in the request changes nothing.

**`gatewayUrl` is `null` today.** No gateway has been chosen, so the order is
priced and recorded and there is nowhere to hand off to; the sheet stops on a
neutral notice rather than navigating, and deliberately does not congratulate
anyone. That is what `null` has always meant in this contract. When a gateway is
picked, the registration call goes between the insert and the reply.

**What gets written.** `orders` gets the Rial amount, `amount_usd`, and the
`fx_rate_id` that converted between them — without that last one every margin
figure silently rewrites itself the next time the rate moves. `micro_credits` is
**one term's** grant even on an annual order, because annual buys twelve
payments made at once and not a year of coins on day one; a year in one lot
would expire in thirty days.

**The rate comes from `fx_rates`** (`USD`→`IRR`, the row with `valid_to IS
NULL`), and with none published the route answers 503 rather than falling back
to a constant compiled into the server. The browser prices the sheet from the
same row: `GET /plans` serves it as `tomanPerUsd` and `toman()` takes it as an
argument. It used to be a constant in `src/data/plans.ts`, set by hand in
2026-07 and 28% below the market by September — every card quoted a price the
gateway would not have charged, and the sheet's cross-check would have fired on
each one. The remaining coupling is the rounding: both sides round to the
nearest thousand Toman, so `tomanFor()` here and `toman()` there must keep
rounding the same way, and the served rate is a whole number of Toman so that
they can.

| Outcome            | Status | Meaning                                                                                                           |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `unknown_plan`     | 404    | Retired, private or misspelled — one answer for all three, so this cannot be used to discover private plan codes. |
| `no_annual_option` | 409    | A year was asked for on a plan sold only monthly. Refused rather than quietly billed monthly.                     |
| `no_exchange_rate` | 503    | No published USD→IRR rate. Ours to fix.                                                                           |
| `no_account`       | 503    | A signed-in user whose row carries no personal account — a broken signup, not a bad request.                      |

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
  "preferUnlimited": false, // optional; absent means true — see below
  "referenceAssetIds": { "image_urls": ["0199…"] }, // slot -> ordered asset ids
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
- **`preferUnlimited` is a mood, not a price.** It names no feature, model or
  price — it says the customer would rather wait than spend, and a `true` can
  only ever make a generation slower and cheaper. **Absent means `true`**: the
  grant has always applied automatically to anyone holding it, so reading a
  missing field as `false` would start charging every client that has not been
  taught to send it, and only the customers on the plans that were sold the
  perk. So `false` is the interesting value — _bill me, I want the quick
  queue_. Read the response's `unlimited` block to learn what actually
  happened rather than assuming you got what you asked for.
- **`concurrency` is always present.** Price is not the only reason a
  generation might not start. Quoting is deliberately **not** refused when the
  account is full — the price is still the price, and a client that knows it is
  at 4 of 4 can say so instead of finding out by being rejected.
- **`referenceAssetIds` names stored files by id, never by URL.** Upload through
  `POST /assets` first; the ids go here as `slot key -> ordered asset ids`,
  where the slot key is the catalogue's (`image_urls`, `first_frame_url`) and
  the order matters — first and last frame are two entries in one slot on
  several video models. The key is the provider's field name and says nothing
  reliable about meaning (`image_url` is an opening frame on one model and
  reference material on another); every slot in `GET /catalog` also carries a
  **`role`** — `reference`, `first_frame`, `last_frame`, `source_video`,
  `source_audio` or `mask` — which is what a client should read to label a slot
  or carry a file between two models that spell the field differently.
- **A finished generation is also a legal input.** The `assetId` on a job's
  output can be named here directly, which is what "to video" on an image does:
  the file is already ours, already the caller's, and already checked, so making
  the client download and re-upload it would store a second copy of the same
  bytes to arrive at the same row. Both origins are accepted — `upload` and
  `generated` — and nothing else.
- **An asset id is not an authorisation.** Every id is checked before anything
  is priced: it must be the caller's account's, one of those two origins, and
  not deleted. A caller naming somebody else's private file would never see the
  bytes, but would see the picture made from them, which is the same leak
  wearing a hat. A failure is `unknown_reference`, 404, with one message for
  missing, deleted, wrong-origin and somebody else's — telling those apart would
  make this route an oracle for whether an asset id exists.
- **All or nothing.** One unusable id refuses the whole quote rather than
  pricing what is left. Partial acceptance is the silent-drop bug in a new hat:
  two faces attached, one refused, and the picture comes back made from one face
  at the price of two.
- **The job takes them from the quote, never from the submission.** `params` is
  hash-bound; the references sit outside that hash, so reading them from the
  `POST /jobs` body would let a quote with no attachments be spent on a job that
  drew from a face. The job keeps its own copy because 0023 purges expired
  quotes and "what went into this picture" outlives them.
- **A reference that has gone fails the job and refunds**, rather than
  generating without it — `reference_unavailable`. A first-frame model handed no
  first frame does not error; it makes something else and charges for it.
- **The provider fetches the reference itself, from a URL we sign.** That URL is
  signed against `OBJECT_STORAGE_PUBLIC_ENDPOINT`, so it has to be an address the
  _provider's_ servers can reach — `https://files.deev.ir` in production. **In
  local development that variable is unset, so the URL says `127.0.0.1:9000` and
  no provider on earth can fetch it.**

  This affects **every** generation carrying a file, not only image-to-video:
  Recraft, Topaz, Nano Banana with references, and every first/last-frame video
  model. Text-to-image and text-to-video attach nothing and run locally.

  The worker now refuses these before calling the provider, with
  `reference_unreachable`, rather than spending the call and reporting
  `provider_failed` — which read as the provider's fault and cost a real
  generation to learn otherwise. The coins are held and refunded either way.

  There is no way around it inside the request. KIE rejects a `data:` URI
  (`"image file type not supported"`) and publishes no upload endpoint, so the
  file has to be somewhere public. To run these locally, point
  `OBJECT_STORAGE_PUBLIC_ENDPOINT` at a store the internet can read — the real
  bucket, or a tunnel (`cloudflared tunnel --url http://127.0.0.1:9000`) — and
  restart the worker.

- **A single-file slot goes up as a bare string, a multi-file slot as an array**,
  decided by the slot's own `max`. The runner learns the slots from
  `provider_models.capabilities`, resolving the **variant's** declaration and
  falling back to the **family's** — the same resolution `variantRefs()` does for
  the screen. Reading only the variant's was a real bug: 29 of 44 variants
  declare none of their own, so the runner defaulted to "assume many" and sent
  Recraft `image: ["https://…"]` where it wanted a string. KIE answers that with
  a generic `500 "Image service internal error"`, which is indistinguishable
  from an outage; its `remove-background` sibling is the one that says so
  plainly, `422 image_url必须是http(s) URL`.
- **Quotes expire in five minutes** and are bound to a hash of `params`, so a
  cheap quote cannot be spent on an expensive job.
- **Asking the price consumes nothing.** The free allowance is spent at job
  submission, never here — a quote a customer never acts on must not cost them
  part of their day.

| Status | Meaning                                                                |
| ------ | ---------------------------------------------------------------------- |
| 401    | Not signed in                                                          |
| 404    | `unknown_variant`                                                      |
| 409    | `not_offered` / `no_price` — the variant exists, those settings do not |

There is no 403 here any more. It carried `tier_too_low` — "this model needs a
higher plan" — and no model needs one. A quote either prices the generation or
says the combination is not sold; whether the account can afford the price is
answered at submission, by the hold.

### `POST /jobs`

Turns a quote into a queued job. Requires an `Idempotency-Key` header.

```jsonc
// request — params must be byte-identical to what was quoted
{ "quoteId": "0199…", "params": { "resolution": "1K" } }
```

```jsonc
// 202 — the same shape GET /generation/jobs/:id and the gallery answer with
{
  "id": "0199…",
  "status": "queued",
  "familyId": "gpt-image",
  "variantId": "gpt-image-2",
  "coins": 2,
  "prompt": "a lighthouse at dawn",
  "createdAt": 1755353400000,
  "updatedAt": 1755353400000,
  "outputs": [],
  "urlsExpireAt": null,
}
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

**All three of those promises hold when the two requests arrive at the same
moment**, which is not the same claim and used not to be true. Submissions are
serialised per account — `for no key update` on the account row, taken before
anything is read — because each of the three decisions is made from a count that
another uncommitted transaction was about to invalidate. Without it, two
simultaneous retries with one `Idempotency-Key` both inserted and the loser died
on a unique index: a 500 for the one thing an idempotency key exists to make
safe. Same for a quote submitted twice at once, and a plan's concurrency limit
could be walked straight past. `generationConcurrency.integration.test.ts`
reproduces all three on two real connections; each was seen failing before it
was fixed.

Only same-account submissions serialise. Two customers never touch the same row,
so what this costs is exactly the concurrency the per-account limit already
denied.

### `GET /generation/jobs/:jobId/outputs/:index/download`

Saves one output instead of displaying it. Answers **302** to the same file,
signed with `Content-Disposition: attachment` and a filename derived from the
stored mime type. Scoped to the caller, and a missing job or index is a 404 for
the same reason as above.

It exists because the `download` attribute on an anchor is honoured **only for
same-origin URLs**, and an output URL is never same-origin — it is signed against
the object store's host (`files.deev.ir` in production), not the app's. The
attribute was silently ignored and the browser did the other thing it knows how
to do with a picture: opened it in a tab.

A redirect rather than a proxy: the bytes still travel store → browser, and the
only thing this adds is the session check and one header. It is also why the
inline `url` on an output carries no disposition — the same object is an
`<img src>` on two screens, and an attachment header would stop it rendering.

### Refusing a prompt

Both `POST /generation/quotes` and `POST /jobs` read the prompt before doing
anything else, and answer **422** when it breaks a content rule:

```jsonc
{ "error": { "code": "prompt_refused", "message": "…", "category": "…" } }
```

**422 and not 403.** Nothing is wrong with the account or the session — the
request itself is one that will not be processed, and a 403 reads as "you are
not allowed here" and sends people to support.

Checked on both surfaces on purpose. The quote is where somebody finds out
before they have committed to anything and before a hold is placed; the job is
the one that is load-bearing, because a client can replay an old quote id or
skip the quote call entirely. The job route reads the prompt out of `params` —
what the worker hands upstream verbatim — rather than any field beside it.

`message` is the rule's own Persian reason, or a general one. **It never names
the phrase that matched**: a refusal that quotes the rule teaches the blocklist
one request at a time. `category` names the published rule, which is safe.

Every refusal is recorded with the prompt, the rule and the surface. A failure
to record it does not rescue the request — a logging outage must not become a
content incident.

The rule set ships **empty**, so a fresh deployment refuses nothing. The
mechanism is code and the list is a legal judgement; a list a program invented
would read as policy while being nobody's.

### `GET /generation/jobs/:jobId/references`

The files a generation was run against, so it can be run again with them:

```jsonc
{
  "references": [
    {
      "slot": "image_urls",
      "assetId": "0199…",
      "url": "https://…?X-Amz-Signature=…",
      "kind": "image",
    },
  ],
}
```

`slot` is the key the next request has to put the file back in, and **order
within a slot is meaning, not presentation** — on a first-and-last-frame model
position decides which frame is which.

Submit the `assetId`. The `url` is signed, expires with everything else here,
and exists so the form can show which file it arrived holding.

**Scoped through the job, never by asset id.** The caller names a generation the
ownership check already covers and the ids come out of that row, so there is no
second authorisation problem to get wrong. A job that is not the caller's
answers `{"references": []}` rather than 404 — to anyone who is not the owner,
"this job has no references" and "this job is not yours" are the same answer. A
reference whose asset has since been deleted is simply absent: the list is what
can still be attached, not what once was.

Its own route rather than a field on the job, for the same reason as the
download link: a page of thirty generations would sign every reference of every
row to fill a form nobody has opened yet.

### `GET /generation/jobs/:jobId`

The same shape, scoped to the caller. Somebody else's job is a **404, not a
403** — a job id is not a capability, and a 403 would confirm it exists.

Poll this after submitting. `status` walks `queued` → `running` → `succeeded`
or `failed` — or `queued` → `cancelled` when the customer takes it back first;
the terminal states are final and nothing moves afterwards. Once it
succeeds, `outputs` carries the files:

```jsonc
{
  "id": "0199…",
  "status": "succeeded",
  "familyId": "gpt-image",
  "variantId": "gpt-image-2",
  "coins": 2,
  "prompt": "a lighthouse at dawn",
  "params": { "prompt": "a lighthouse at dawn", "aspect": "1:1", "resolution": "1K" },
  "referenceAssetIds": {},
  "createdAt": 0,
  "updatedAt": 0,
  "urlsExpireAt": 1755357000000,
  "outputs": [
    {
      "assetId": "0199…",
      "url": "https://…?X-Amz-Signature=…",
      "kind": "image",
      "mimeType": "image/png",
      "width": null,
      "height": null,
      "durationMs": null,
    },
  ],
}
```

**Every `url` is signed and expires.** Nothing here is a public object: a
generation belongs to whoever paid for it, and a bucket that serves anything to
anyone who knows a key is not access control. Treat a URL as a loan — store
`assetId` if something has to be remembered, and refetch when `urlsExpireAt`
passes rather than after an image has already failed to load.

**A failed job's `error` is ours, not the supplier's.** `error.code` is one of a
fixed set — `provider_unavailable`, `submit_failed`, `poll_failed`,
`provider_timeout`, `provider_cancelled`, `provider_failed`, `content_policy`,
`no_output`, `storage_failed`, `worker_lost`, `reference_unreachable` — and `error.message` is a fixed sentence chosen by
that code. Anything the upstream said is written to `job_attempts` and to the log
for whoever debugs it, and is never copied onto the job. It used to be: a missing
credential came back as "…is not configured (WAVESPEED_API_KEY is not set)",
which named the supplier and our env-var convention in one string. Codes outside
the set collapse to `provider_failed`, so a provider inventing a new one cannot
leak through the gap. Render by `code`; treat `message` as a fallback, not a
diagnosis.

`width`, `height` and `durationMs` are measured from the file itself, by the
worker, at the moment it mirrors the output — the one point the whole file is in
memory. They describe what was delivered, which is not always what was asked
for.

Any of them can still be null, and a screen must handle that rather than assume
a number. Null means the format carries no such property — an mp3 has no
dimensions — or that it is one we do not parse: PNG, JPEG, GIF, WebP, MP4 and
QuickTime are read for size, MP4, QuickTime and MP3 for duration, and anything
else measures as null rather than as a guess. A pre-existing row is also null,
because nothing backfilled what was never recorded.

### `DELETE /generation/jobs/:jobId`

Takes one generation off the customer's wall. Answers **200
`{ "outcome": "removed" }`**.

A **soft** delete: `jobs.deleted_at` is stamped and every read here already
filters on it. The row itself stays, because it is the accounting record as well
as the gallery item — the hold, the capture and the provider's cost all point at
it, and a customer tidying a failed attempt off their wall is not a reason to
lose the trail for money that moved. Assets keep their own lifecycle and are
reaped on their own schedule, not by this.

**409 `job_running` while the generation is still queued or running.** That
refusal is the point of the route rather than an edge of it: a live job has
credits held against it, and a row that vanished while its hold stood would
leave the customer short by an amount nothing on their screen could account for.
Stopping a queued generation is a different act with a different effect on
the money — `POST /generation/jobs/:jobId/cancel`, below — and deleting the row
would be neither.

**404** for a job that is not the caller's, a job already removed, and a `draft`
— same reason as the read above: whether an id exists is not this caller's
business.

### `POST /generation/jobs/:jobId/cancel`

Takes back a generation that has not started, with its coins. No body; the
same session as the other job routes.

| Job state                             | Answer                                                          |
| ------------------------------------- | --------------------------------------------------------------- |
| `queued`                              | **200** — the job, same shape as the GET, `status: "cancelled"` |
| already `cancelled`                   | **200** — the same job again; a double tap is not a failure     |
| `running`                             | **409 `job_started`** — the worker got there first              |
| `succeeded` / `failed` / `expired`    | **409 `job_finished`**                                          |
| someone else's, removed, or a `draft` | **404 `job_not_found`**                                         |
| no session                            | **401 `unauthorized`**                                          |

**`queued` only.** A running job has already gone to a provider, which may bill
us whatever we do.

**The money is `fail()`'s, in one transaction.** The hold is released, a free
generation's slice of today's allowance is given back, and the row ends
`cancelled` with `completed_at` set, `micro_credits_charged = 0` and **no error
code** — it did not fail, and `record_job_event` emits `job.cancelled` from the
status alone. `releaseJobMoney` in `jobRunnerRepository.ts` is the one
implementation both use. The concurrency slot comes back at once, since only
`queued` and `running` count against `max_concurrent_jobs`.

**Safe against the worker** because the cancel locks the row `for update` and
`claim()` is a single conditional `update … where status in ('queued','running')`.
If the cancel commits first, the claim matches nothing and the runner skips the
job with no provider call. If the claim commits first, the cancel reads
`running` and answers `job_started`. The BullMQ entry stays in the queue and is
skipped when its turn comes.

### `GET /gallery`

Everything this account has made, newest first. Requires a session.

```
GET /api/v1/gallery?limit=24&kind=image&cursor=0199…
```

```jsonc
{ "items": [/* GenerationJobSchema[] */], "nextCursor": "0199…" }
```

- **`limit` is 1–60**, default 24. Outside that range is a 400, not a silent
  clamp — a client asking for 5000 has a bug worth surfacing.
- **`kind` filters on what was made, not on what the family is called.** It
  reads the job's feature modality, because a family's kind is not its variants'
  — `topaz` is an image family whose second variant produces video.
- **`nextCursor` is opaque.** Pass it back; do not parse it. It is keyset
  pagination on the primary key rather than an offset, which is why a
  generation finishing mid-scroll cannot shift the page under the reader.
  Absent on the last page.
- **Drafts are excluded.** A draft was never submitted, and a gallery of things
  that did not happen is not a gallery.

### `POST /assets`

A reference image, as `multipart/form-data` with one `file` part. Requires a
session. **201** when something was stored, **200** when it was already here.

```jsonc
{
  "id": "0199…",
  "url": "https://…?X-Amz-Signature=…",
  "kind": "image",
  "mimeType": "image/png",
  "byteSize": 7872,
  "deduplicated": false,
  "urlExpiresAt": 1755357000000,
}
```

| Status | Why                                                          |
| ------ | ------------------------------------------------------------ |
| 200    | `deduplicated: true` — these exact bytes were already here   |
| 201    | Stored                                                       |
| 401    | No session                                                   |
| 413    | Over 15MB                                                    |
| 415    | Not a PNG, JPEG, GIF or WebP — or the body was not multipart |

Three things are worth knowing before building against it:

- **The declared `Content-Type` is used for nothing.** The type is read from the
  file's own magic bytes. An HTML document sent as `image/png` is a 415, which
  matters because a signed URL later hands the file back with whatever type we
  recorded.
- **`deduplicated` is real and worth surfacing.** The bytes are hashed, and a
  re-upload of the same reference returns the id the first one got without
  transferring anything. Somebody trying four prompts against one face uploads
  it once. Dedupe is scoped per account — a global one would be cheaper still
  and would also mean handing one customer another customer's asset id.
- **The bytes go through this API, not straight to storage.** No presigned PUT,
  which means the object store needs no CORS, no public port, and can sit on a
  private network. It costs a round trip through Node for a few megabytes and
  buys the size ceiling, the type check and the hash — none of which a signing
  policy can do.

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

| `error_code`             | Means                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `provider_unavailable`   | No adapter for that provider — configuration, not weather      |
| `credential_unavailable` | No active credential, or its secret is not in the environment  |
| `submit_failed`          | The provider would not accept the task                         |
| `poll_failed`            | The provider stopped answering about a task it accepted        |
| `provider_timeout`       | Accepted, never finished                                       |
| `no_output`              | Reported success and returned no files                         |
| `worker_lost`            | The queue gave up on the job before the worker could settle it |

`no_output` is a failure on purpose. Capturing a hold there would charge
somebody for an empty gallery.

`worker_lost` is the queue settling a job the worker never got to finish — a
process killed mid-poll and then found stalled more times than BullMQ allows.
Nothing settles `jobs.status` except the worker's own success and failure paths,
so before this code existed such a row stayed `running` for ever with the
customer's credits still held, and no reaper anywhere would have found it. It is
always a refund, and it is always worth retrying.

### Which provider runs a job

`jobs.provider_model_id` is the row the **customer picked**. The row that
**actually runs** can be a different provider's entirely, and three things get a
say, in this order:

1. an **unlimited grant**, which named a serving account when it was sold
2. an active **`model_routes`** row — an admin's standing preference
3. otherwise the catalogue row runs itself, which is the common case

That order is a money decision. A grant is a promise about a specific upstream
account, so letting a routing preference outrank it would bill us for
generations sold as free.

A route can carry `param_overrides`, applied to the params immediately before
submit and nowhere else — `rename`, then `map`, then `set`, then `drop`. The
`map` step exists because renaming is not enough: KIE takes
`aspect_ratio: "16:9"` where WaveSpeed's qwen-image takes `size: "1344*768"`.
Same customer choice, different alphabet. `job.params` itself is never touched,
because it is what the price was hashed from and what the gallery shows back.

### KIE is verified; WaveSpeed is not; useapi has no adapter

`packages/adapters/src/providers/kie.ts` is written against the shapes
`scripts/spike-kie.ts` verified on the live API — including the two the docs do
not tell you: a 200 can carry a failure (the task id's absence is the error),
and `resultJson` is a JSON string nested inside the JSON body.

`wavespeed.ts` exists and is wired into `createGenerationProvider`, but it is
written from **published documentation rather than from a call that returned
200**. It differs from KIE in four ways that all matter: the model id goes in
the URL path, the params are flat rather than nested under `input`, the result
is a plain array of URLs at `data.outputs`, and **nothing reports what a
prediction cost** — so `providerUnitsCost` is always null and settlement falls
back to the quote's own estimate.

Which is why **every seeded WaveSpeed route is inactive**. Four exist —
`qwen-image`, `seedance-2-fast`, `wan-2-7`, `kling-3`, the ones the provider
analysis found WaveSpeed actually wins on — and each records in its `note` what
is actually known about its path. `scripts/spike-wavespeed.ts` is what turns
that into a fact; activating a route before running it means finding out from a
customer's refund.

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

Today: **Nano Banana Pro and Nano Banana 2, free to tier 2 and up — Pro,
Studio and Creator — 50 a day per account, and only while the plan's unlimited
window is open.**

What keeps this a perk rather than a write-off is the clock, not the tier. The
grant used to sit one tier above the model's own `minTier`, so that Pro reached
the model and paid while the top two got it free. No model is gated by tier now,
so that gap had nothing left to stand on: everyone can reach every model and the
only question is who gets it free. `plans.unlimited_days` answers it — a week on
Pro, a month on Studio and Creator — which bounds the giveaway in time and makes
it a reason to buy again rather than a standing cost.

What a UI needs to know:

- **The same variant is served by two providers and the customer never sees
  that.** `GET /catalog` returns exactly one Nano Banana Pro. The second
  provider's row exists in `provider_models` but carries no `variant` in its
  capabilities, and the catalogue query excludes rows without one — otherwise
  the model would render twice and half the picks would be wrong.
- **`GET /catalog` says which variants have the pipe.** A variant that has one
  carries `unlimited: { dailyCap, minTier, limits? }`; the rest carry nothing.
  It is **derived from `unlimited_entitlements` when the document is built**,
  never seeded into `capabilities` — one row answers both the shop and the
  quote, so the two cannot come to disagree and advertise a pipe that has been
  withdrawn. A grant whose serving model or provider is switched off is not
  published, for the same reason `findGrant` refuses it.
- **`minTier` is on the marker so a screen can offer the upgrade** instead of a
  switch that fails. Without it the pipe looks available to everyone, and a
  customer on the wrong plan flips something labelled free and is charged.
- **`limits` names the settings the pipe covers**, as `control key -> allowed
values`, and a key it does not mention is unconstrained. The subscription
  serves Nano Banana to 2K; 4K is quoted and billed the metered way even for an
  entitled account. Say so before the choice is made — after it, the customer
  has already been charged. _(The 2K ceiling is currently unverified: there is
  no useapi token in this environment to ask. It restricts rather than permits,
  which is the safe side, and the useapi spike replaces it with a measured
  fact.)_
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

- **useapi, so unlimited generation cannot actually generate.** A tier-3
  customer is quoted free, the submission succeeds, and the job then fails with
  `provider_unavailable` and a full refund of the day's allowance. Nothing is
  charged and nothing is lost, but nothing is produced either. Needs a token
  and a spike — see "KIE is wired; useapi is not" above.
- **Cover images and voice previews still hotlink the supplier's CDN.** Every
  other trace of who runs our models is out of the browser now, but a family
  cover in `src/data/models.ts` and a voice preview in
  `src/features/content/labels.ts` are still `<img>`/`<audio>` sources pointing
  at the upstream's asset host — so the network tab names them even though no
  JSON does. Fixing it means mirroring those files into our own bucket and
  reseeding the URLs; deliberately deferred, recorded here so the next person
  finds a known gap rather than a discovery. Generated outputs are already
  mirrored — this is only the static catalog art.
- **Payments.** Plans render and price correctly; nothing charges. Blocked on
  which Iranian gateway to use — ZarinPal, IDPay, NextPay and Zibal all work
  differently enough that the choice comes first.
- **Nothing measures a WebM, OGG or WAV file.** Every format our providers
  actually return is measured; these three are parsed by nobody because nothing
  produces them. `assets.width`, `height` and `duration_ms` stay null for them,
  as they do for every row written before measurement existed — there is no
  backfill.

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
