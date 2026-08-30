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

| `AppServices` call      | Frontend requests          | Server route          | Status   |
| ----------------------- | -------------------------- | --------------------- | -------- |
| `session.getCurrent()`  | `GET /session`             | `routes/session.ts`   | **Live** |
| `auth.*` (5 methods)    | `POST /auth/*`             | `routes/auth.ts`      | **Live** |
| `catalog.list()`        | `GET /catalog`             | `routes/catalog.ts`   | **Live** |
| `content.list()`        | `GET /content`             | `routes/content.ts`   | **Live** |
| `community.list()`      | `GET /community`           | `routes/community.ts` | **Live** |
| `community.share()`     | `POST /community`          | `routes/community.ts` | **Live** |
| `plans.list()`          | `GET /plans`               | `routes/plans.ts`     | **Live** |
| `wallet.getCurrent()`   | `GET /wallet`              | `routes/wallet.ts`    | **Live** |
| `generation.quote()`    | `POST /generation/quotes`  | `routes/quotes.ts`    | **Live** |
| `generation.create()`   | `POST /jobs`               | `routes/jobs.ts`      | **Live** |
| `generation.getJob()`   | `GET /generation/jobs/:id` | `routes/jobs.ts`      | **Live** |
| `gallery.list()`        | `GET /gallery`             | `routes/gallery.ts`   | **Live** |
| `assets.upload()`       | `POST /assets`             | `routes/assets.ts`    | **Live** |
| `campaign.getActive()`  | `GET /campaigns/active`    | `routes/campaigns.ts` | **Live** |
| `payment.createOrder()` | `POST /payments/orders`    | `routes/payments.ts`  | **Live** |

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
{ "status": "anonymous", "host": "web", "authProviders": ["google"] }
// or
{ "status": "authed", "host": "web", "authProviders": ["google", "microsoft"],
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

Locally neither is configured, so the list is `[]` and the sign-in screen shows
phone and email only. That is correct, not a bug: **neither Google nor Microsoft
is dependably reachable from Iran without a VPN**, so phone OTP is the route
most people will take regardless.

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

**Where it comes from.** `content_items`, seeded by `pnpm content:publish` from
`src/data/content.rows.json`. That seeder never writes `status` on a row that
already exists and never deletes — pulling something is a decision a person
made, and a seed run must not reverse it. `sort_order` does update, because the
file is still the source of truth for order while no panel exists.

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

`/api/v1/admin/*` — invite and discount CRUD, per-code usage and spend, the
early-access switch, and **providers and model routing**.

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
`plans.rows.json` beside it is the seeder's _input_; both are generated, so
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
to a constant compiled into the server. Note the coupling: the browser still
holds `TOMAN_PER_USD` in `src/data/plans.ts` to render the figure on the sheet.
They agree today. If they ever drift, the sheet's own cross-check fires and
refuses to send anyone to a gateway — safe, and completely broken until the two
are reconciled. Move both together.

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

### `GET /generation/jobs/:jobId`

The same shape, scoped to the caller. Somebody else's job is a **404, not a
403** — a job id is not a capability, and a 403 would confirm it exists.

Poll this after submitting. `status` walks `queued` → `running` → `succeeded`
or `failed`; the terminal states are final and nothing moves afterwards. Once it
succeeds, `outputs` carries the files:

```jsonc
{
  "id": "0199…",
  "status": "succeeded",
  "familyId": "gpt-image",
  "variantId": "gpt-image-2",
  "coins": 2,
  "prompt": "a lighthouse at dawn",
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
`no_output`, `storage_failed` — and `error.message` is a fixed sentence chosen by
that code. Anything the upstream said is written to `job_attempts` and to the log
for whoever debugs it, and is never copied onto the job. It used to be: a missing
credential came back as "…is not configured (WAVESPEED_API_KEY is not set)",
which named the supplier and our env-var convention in one string. Codes outside
the set collapse to `provider_failed`, so a provider inventing a new one cannot
leak through the gap. Render by `code`; treat `message` as a fallback, not a
diagnosis.

`width`, `height` and `durationMs` are null today. The columns exist and the
gallery reads them; nothing measures a file on the way in yet, and a screen
should lay out from the variant's aspect ratio rather than wait for them.

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
- **Reference images are accepted but not yet attached to a generation.**
  `POST /assets` stores one and hands back an id; nothing sends those ids with
  a quote. `GenerationsProvider` refuses a generation carrying references
  rather than silently dropping them, and the TODO there names the two lines it
  needs. That is UI work now, not backend work.
- **Nothing measures a file.** `assets.width`, `height` and `duration_ms` are
  written null. The gallery reads them and a screen can lay out without them.
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
