# Contributing to DEEV

Two people work on this repository: one on the backend (API, database, auth,
admin), one on the UI. This file is how those two stay out of each other's way.

Read [`README.md`](README.md) first — it explains what the system is. This file
explains how to work in it.

## Getting started

You need [Node 22](.nvmrc) and pnpm. **Do not install pnpm from npm's latest
tag** — the version is pinned in `package.json` and corepack reads it:

```sh
corepack enable
corepack prepare pnpm@11.16.0 --activate
```

If `pnpm -v` disagrees with the `packageManager` field, you are running the
wrong one, and `pnpm install --frozen-lockfile` will fail with a lockfile
compatibility error rather than anything that names the real problem.

Then:

```sh
git clone https://github.com/vrtmis-ai/vgen.git
cd vgen
pnpm install --frozen-lockfile
cp .env.example .env      # .env is gitignored; keep it that way
pnpm dev                  # http://localhost:5180
```

**That is the whole setup for UI work.** With `NEXT_PUBLIC_APP_MODE=demo` (the
default in `.env.example`) the app runs entirely on the in-memory adapters in
`src/adapters/demo/` — a deterministic catalog, wallet, session and generation
flow, with no database, no Docker, no API server and no keys. You can build
every screen without a backend existing.

When you do need the real stack — Postgres, Redis, MinIO, migrations, API and
web together — that is `pnpm dev:stack`, and it needs Docker Desktop running.

## Setting up the backend

```sh
cp .env.example .env.local        # NOT .env — see below
docker compose up -d --wait       # Postgres, Redis, MinIO
pnpm db:setup                     # migrate, then seed
```

`pnpm db:setup` is `db:migrate` followed by `db:seed`, and `db:seed` runs the
five publishers in the one order that works. They are order-dependent because
each of the later ones looks the catalogue up by variant id and refuses rather
than inventing a row:

```
catalog → pricing → plans → unlimited → providers
```

All five are idempotent. Re-running prints `already current` and writes nothing,
which is why `pnpm dev:stack` now seeds on every start — without it you get a
migrated database with an empty catalogue, and `GET /catalog` answers 200 with
zero families, which reads as a broken app rather than an unseeded one.

### `.env.local`, not `.env`

This is the one that costs an hour. Next.js reads `.env`; **no backend
entrypoint does.** `packages/db/src/migrate.ts`, `apps/api/src/server.ts`, the
worker and every seeder load `.env.development.local` and `.env.local`, in that
order, and nothing else. Copy to `.env` alone and `pnpm db:migrate` fails with

```
DATABASE_URL is required
```

which names the symptom and not the cause. Copy to `.env.local` — or to both, if
you also want the web tier pointed at the real API.

### Which secrets are yours and which are shared

Most of `.env.example` ships with working local values. Of the blanks:

**Generate your own.** Never copy these between machines — they only need to be
stable _within one database_, and yours is not anyone else's:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`RATE_LIMIT_HASH_SECRET`, `PHONE_HASH_PEPPER`, `MFA_SEALING_KEY`. Two of those
are deploy-once even locally: changing `PHONE_HASH_PEPPER` re-opens the free
trial for every number already in your database, and changing `MFA_SEALING_KEY`
invalidates every TOTP enrolment in it.

**Genuinely shared**, and passed person to person rather than through the repo:
`KIE_API_KEY`, `KAVENEGAR_API_KEY` and `KAVENEGAR_TEMPLATE`, the `GOOGLE_` and
`MICROSOFT_` OAuth pairs — though nobody holds those last two yet, because the
applications behind them have never been registered; see
[docs/OAUTH-SETUP.md](docs/OAUTH-SETUP.md) if that is the job you picked up. `WAVESPEED_API_KEY` nobody holds yet and `USEAPI_*`
has no adapter, so both stay blank.

**You need none of them for most backend work.** The migrations, all five
seeders, the integration suite, quotes, credit holds, the admin API and provider
routing all run with every third-party key blank. Only actually producing a
picture needs `KIE_API_KEY`.

### Checking it worked

```sh
pnpm backend:test:integration   # 181 tests against the real database
pnpm check:pricing              # 738 prices recomputed from the seeded rows
```

### Opening the admin panel

The panel is at `/admin` and needs three things the product's own sign-up cannot
give anyone: a password, the `admin` role, and a **confirmed second factor** —
`POST /admin/session` refuses an account without one outright, because letting
someone in "just this once" is how `v_admins_without_mfa` stops being empty.

```sh
pnpm admin:create you@example.com 'a-long-password'
```

It prints an `otpauth://` URI. **Add it to an authenticator app before closing
the terminal** — the secret is sealed into the database and that is the only
moment it exists in readable form. Losing it means running the command again.

The panel talks to the real API, so demo mode cannot serve it (there is no
fixture that could stand in for a page that changes which upstream account a job
is billed to). Point the browser bundle at your local API in `.env.local`:

```sh
NEXT_PUBLIC_APP_MODE=production
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:5181/api/v1
```

Then `pnpm dev` (5180) alongside the API (5181), and open
<http://127.0.0.1:5180/admin>. Set `NEXT_PUBLIC_APP_MODE=demo` again to go back.

## Upgrading a clone you already had

If your checkout predates the Next.js move, `git pull` on its own leaves you in
a state that fails for reasons that do not look like their cause. Do this once:

```sh
git switch main && git pull

rm -rf node_modules .next dist          # the old tree was npm-installed and Vite-built
git rm --cached -r -q . && git reset --hard   # rewrite the working tree as LF

corepack pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Why each line is there, because none of them is guessable from the error:

- **`node_modules`** came from `npm ci` against React 18, Vite and Clerk — all
  three are gone. `dist/` is a build artifact of a bundler the repo no longer
  uses, and `.next/` may hold a cache from a different dependency tree.
- **The line-ending rewrite** is the subtle one. `.gitattributes` is new, and it
  only takes effect on checkout — files git did not have to rewrite during the
  merge keep the CRLF they were checked out with years ago. Measured on a real
  pull from the old main: 5 files stay CRLF, `git status` reports the tree
  **clean**, and `pnpm format:check` then fails on 4 files you never touched.
  The command above forces the re-checkout. It is needed once, ever.
- **`.env`** did not exist before and the variable names changed — `VITE_` is
  now `NEXT_PUBLIC_`.

If you also ran the old backend: the schema was replaced wholesale, so
`docker compose down -v` and `pnpm db:migrate` gives you the current one. The
compose volume was renamed, so the old cluster is orphaned rather than upgraded
— nothing you had locally is migrated, and nothing local was meant to be kept.

## Who owns what

The split is by directory, so it is checkable rather than a matter of memory.

### UI owns

| Path                             |                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `src/screens/`                   | The 15 screens. Almost all UI work is here                                          |
| `src/components/`                | Shared chrome — `TopBar`, `Shell`, surfaces, pickers                                |
| `src/design-system/`             | Tokens, component CSS, and the design docs                                          |
| `app/**/page.tsx`                | The route files, which are deliberately thin — they read a hook and render a screen |
| `src/fonts.css`, `src/index.css` | Type and the Tailwind layer                                                         |

### Backend owns

| Path                                   |                                                                                     |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/api/`, `apps/worker/`            | Fastify routes, auth, admin, the queue consumer                                     |
| `packages/db/`                         | Repositories **and** `migrations/` — never edit an applied migration, add a new one |
| `packages/core/`, `packages/adapters/` | Pricing, money math, secrets, Redis and S3 adapters                                 |
| `src/runtime/`                         | Providers, session gates, and the HTTP adapters the screens consume                 |

### Shared — say something first

`app/layout.tsx`, `src/data/` (the catalog and plan definitions), `packages/contracts/`,
`docker-compose.yml`, and this file. These are where the two halves meet, so a
silent change is how a merge conflict becomes a bug.

## The interface between us

**[`docs/API.md`](docs/API.md) says what the backend currently serves** — which
endpoints are live, which the frontend calls but the server does not answer yet,
the error codes worth branching on, and what is deliberately unbuilt. The
backend owner keeps it current. Read it before wiring a screen to anything real,
and trust it over any assumption about what a route probably returns.

**`packages/contracts/` is the boundary.** Every request and response has a Zod
schema there, and both sides import it — the API parses with it, the web tier
types against it.

So when a screen needs a field the API does not return yet, the change starts
there, not with a `fetch` inside a component:

1. Add or extend the schema in `packages/contracts/src/`.
2. Tell the backend owner. The route and the repository are their side.
3. Build the screen against the demo adapter in `src/adapters/demo/` in the
   meantime — that is what it is for. You are never blocked waiting on an
   endpoint.

Adding a raw `fetch` to a screen is the one thing that will get a PR sent back:
it bypasses the contract, the demo mode, and the error handling all at once.

## Branching and merging

`main` is protected by convention, not by settings — **nobody pushes to it
directly**, including the person who set that convention.

```sh
git switch main
git pull
git switch -c feat/plans-page-desktop     # or fix/...
# work, commit
git push -u origin feat/plans-page-desktop
gh pr create --base main
```

- **Branch names**: `feat/…` for new work, `fix/…` for repairs, `chore/…` for
  tooling. Short and about the thing, not the ticket.
- **Keep branches small and short-lived.** A branch that lives a week against a
  moving `main` costs more to merge than it saved by being batched.
- **Rebase on main before opening the PR**, so the PR shows your work and not a
  merge of everyone else's:
  ```sh
  git fetch origin && git rebase origin/main
  ```
- **CI must be green before merge.** All four jobs. If a job fails on something
  you did not touch, say so rather than merging past it — that has been a real
  bug more than once.
- **Delete the branch after merging.** Stale branches are how you end up
  re-doing work that already landed.

If we are both editing near each other, rebase more often, not less.

## Conventions

### Commits

Write the subject as a sentence saying what changed and why it matters, not a
label. From this repository's own history:

```
Take Profile and Generate out of the phone column
Give every effect its own page, and its tile two destinations
Stop hiding content behind scrollbars that were painted out
```

Not `feat(profile): update layout`. If the reasoning is not obvious from the
subject, put it in the body — the body is where the _why_ lives, and it is worth
more than the diff in six months.

### Code

- **Run `pnpm format` before pushing.** CI runs `format:check` and will fail
  otherwise. Prettier config is `.prettierrc.json`; do not fight it.
- **Design tokens, not raw hex.** `src/design-system/tokens.css` defines them
  and `src/index.css` exposes them through `@theme static`. A literal `#0a0a0a`
  in a screen is a bug in a product that has a light mode and a rebrand behind
  it.
- **Persian first.** The app is RTL and Persian by default. Copy comes from the
  dictionary in `src/lib/i18n.tsx` through `useI18n()`, which also gives you
  `n()` for numbers — Persian digits are a locale concern, not a string you
  format by hand. Test in RTL; a layout that only works in LTR is not done.
- **Accessibility is not a follow-up.** Every interactive element gets an
  accessible name; `src/design-system/DESIGN.md` has the rules and the e2e tests
  select by role, so an unnamed button breaks the suite as well as a screen
  reader.

### A note on the design docs

`src/design-system/DESIGN.md` and `INTEGRATION.md` are thorough and worth
reading, but both **predate the DEEV rebrand** and still describe an orange
accent. The brand is now black, white and one blue. Where they disagree with
`tokens.css`, the tokens are right.

## Tests

| Command                                          | What it covers                            |
| ------------------------------------------------ | ----------------------------------------- |
| `pnpm test`                                      | Web unit tests (Vitest + Testing Library) |
| `pnpm test:e2e`                                  | Playwright, against a real dev server     |
| `pnpm typecheck` `pnpm lint` `pnpm format:check` | What CI checks                            |
| `pnpm backend:test`                              | Backend units — the backend owner's side  |

For UI work, `pnpm test` and `pnpm test:e2e` are the two that matter. `e2e/`
pins the routing contract — deep links, back/forward, and the 404 → studio
redirect — which is exactly what a screen refactor tends to break. If you change
navigation, expect to update `e2e/navigation.spec.ts` deliberately, and do not
"fix" it by loosening the assertion.

## Gotchas that will otherwise cost you an afternoon

- **Next refuses to start a second dev server in the same directory.** Stop
  `pnpm dev` before `pnpm test:e2e`; Playwright starts its own on 5182.
- **Postgres is on 5442**, not 5432 — a native Postgres service and a sibling
  compose stack both want 5432, and when two listeners share a port the failure
  reads as "password authentication failed" rather than as a conflict.
- **The database's Persian collation is set by initdb and only by initdb.** To
  reset it you need `docker compose down -v` and a re-migrate, not an `ALTER`.
- **Never put a secret behind `NEXT_PUBLIC_`.** That prefix is the browser
  bundle — it ships to every visitor. This repository is public.
- **`.env` is gitignored and stays that way.** Add new variables to
  `.env.example` with a comment saying what they are for.
- The GitHub Pages site at `vrtmis-ai.github.io/vgen/` is **frozen** — it serves
  an old build from before the Next.js move and is no longer deployed to. Ignore
  it.

## What is deliberately unfinished

So you can tell a gap from a bug:

- **No generation submission path.** `jobs.feature_id` is `NOT NULL` and the
  routing from a request to a feature row is an open decision, so submitting a
  generation is not wired end to end yet. The demo adapter fakes it.
- **No queue consumer.** Jobs can be created; nothing processes them.
- **No payments.** Plans render and price correctly; nothing charges.
- **No admin UI.** The admin API is complete and tested; `src/screens/Admin.tsx`
  still talks to local storage.

## Questions

If something here is wrong or missing, change it — this file is shared, and a
convention nobody wrote down is not a convention.
