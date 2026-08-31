# Known flaky tests

A test that fails on a pull request which did not touch it costs somebody an
hour of looking for a bug that is not there — and the second time it happens,
it costs the suite its credibility. This page is where a diagnosed flake goes
so the next person recognises it instead of re-deriving it.

**A flake is not "a test that sometimes fails". It is a test whose failure
carries no information about the change under review.** If the mechanism is not
written down here, treat a red check as real.

---

## `packages/db` · `analyticsRepository.integration.test.ts` — fixed in #54

> `the overview > counts what happened in the window and ignores what did not`
> — `AssertionError: expected 2 to be 1` at line 79

Diagnosed from the frontend side against a backend-owned file and handed over as
a report. The fix landed in #54, which was open at the time and already carried
both halves of it. The mechanism stays on this page because it is the general
one for this suite, not a property of that one test.

### Reproduced

|                                                  | runs | failures |
| ------------------------------------------------ | ---- | -------- |
| that file alone                                  | 12   | 0        |
| full integration suite, parallel (as configured) | 10   | **4**    |
| full integration suite, `--no-file-parallelism`  | 8    | 0        |

### Mechanism

Two files that are each correct on their own, sharing one database:

- **`analyticsRepository.integration.test.ts`** (#36) takes a global
  `select count(*) from jobs`, inserts one job, counts again, and asserts the
  difference is 1. `overview()` is not scoped to an account, so that delta only
  holds if nothing else commits between the two reads.
- **`generationConcurrency.integration.test.ts`** (#42) commits job rows for
  real, through `pool` rather than a rolled-back `tx`. It has to — its own
  header says the bugs it hunts are "a decision made from a count that another
  uncommitted transaction is about to invalidate", and you cannot race inside a
  single transaction that rolls back.

Run in parallel, a job committed by the second between the first's two reads
makes the delta 2.

### It was not only a test problem

The committed rows stayed. On 2026-08-24 a local database held **203 of its 210
`plans` rows** left behind by that harness — seven of them `is_active and
is_public`, so `GET /plans` was serving `Race Test Plan` to the web tier
alongside the seven real ones.

### What #54 changed

Both halves, because the second alone still failed about one run in four:

- **The harness stopped manufacturing plans.** `raceHarness.ts` inserted a
  `race-plan-${random}` on every reset and deleted none, and `is_public`
  defaults to true. It now reuses a single `race-harness` row that is neither
  public nor active, and sweeps what earlier versions left behind.
- **`fileParallelism: false`** in `packages/db/vitest.integration.config.ts`.
  Several files `delete from` a whole shared table inside their rollback
  transaction, so under READ COMMITTED a committed row from another file can
  appear between two statements of a test that has just emptied that table. The
  suite stops being two seconds and becomes ten to twenty, depending on the
  machine.

Verified 2026-08-25: four consecutive runs, 23 files and 285 tests, clean every
time. The `plans` table afterwards holds 8 rows — the seven real ones
`is_active and is_public`, plus the one `race-harness` row, which is neither.

Scoping `overview()` to an account was the more correct of the options and is
still available if a sequential suite ever costs more than it saves.

---

## `src/screens` · `Auth.test.tsx` — fixed, kept here as the shape to recognise

> `the code's minute > …` — `Unable to find a label with the text of: Digit 1 of 6`

Went red twice on markdown-only pull requests (#45, #56). `shouldAdvanceTime`
moved the fake clock along with real time while testing-library measured its own
`waitFor` budget against that same clock, so a busy runner spent the budget
without doing the work. #49 raised the budget 1s → 3s, which moved the machine
it failed on; the fix was to fake `Date` only and leave timers real.

Recorded because the shape recurs: **any `waitFor` under
`useFakeTimers({ shouldAdvanceTime: true })` is measuring patience against a
clock that runner load is spending.** If a test in this repository fails on a
loaded machine and passes locally, check that first.

---

## `e2e` · `auth.spec.ts` — cold compile, not a race

> `the landing page's two entry points open the two auth routes`
> — `Test timeout of 30000ms exceeded`, with the signup screen visibly rendered
> in the snapshot

#61 predicted this one in its own description, which is why it goes here rather
than into a bug report:

> This adds enough code that Next's **cold** compile of `/` and `/profile` got
> slower, and `page.goto` runs against the 30s test timeout rather than the 15s
> `expect.timeout` the config sets. Locally every spec passes on a warm server
> and each failing one passed alone; on CI, which is always cold, this may
> surface as timeouts that look like flakes.

Seen once locally on 2026-08-30, on a suite run immediately after `.next` was
deleted. The tell is in the page snapshot: the screen the test was navigating to
had **rendered**, so nothing was stuck or missing — the compile simply ate the
budget. Warm, the same spec passes in ~10s and the full suite in ~31s.

**What to do about a red one:** re-run the file alone before believing it, which
is the opposite of the advice on the rest of this page and is justified only by
the snapshot showing a correctly rendered screen. If the snapshot shows an error
state, a missing element, or the "content failed to load" panel, it is not this
— read the entry below.

The timeout is deliberately not raised. `playwright.config.ts` explains the 15s
`expect.timeout` as a calibration against dev-server compile time, and the 30s
test timeout is Playwright's own; moving either hides the next real regression
by exactly as much as it hides this.

---

## `e2e` · anything asserting on the landing page — a fixture missing a field

> Every landing assertion fails at once, and the snapshot shows
> `محتوای منتشرشده بارگذاری نشد` — "the published content did not load"

Not a flake. A deterministic failure with a misleading shape, recorded because
it cost an hour and will happen again.

`e2e/fixtures.ts` stubs `GET /content` with `page.route`, so **the e2e suite
never talks to the real API** — which is why the failure survives killing the
API, restarting it, and deleting `.next`, and why bisecting it looks like the
application code broke.

The shell blocks on the content document and paints nothing until it parses. So
**a required field added to `ContentSnapshotSchema` breaks every landing test
until the fixture learns it**, and the error the screen shows is about content
being unavailable rather than about a schema. That is what happened when `flags`
was added for the site banner.

The contract has three copies now — `packages/contracts`, `src/runtime/contracts`
and this fixture. The first two are a deliberate mirror; the fixture is the one
that is easy to forget.

---

## `docker` · `web` restart-loops with `MODULE_NOT_FOUND … @swc/helpers`

> The image builds, the container starts, and it exits immediately naming a
> file inside a package that is present in the image

Not a flake — a deterministic failure with a misleading shape. Recorded because
it cost five image builds and because the two obvious diagnoses are both wrong.

Next's `output: "standalone"` traces the files the server needs and copies them.
For `@swc/helpers` it copies `cjs/` and `package.json` and stops. But
`next/dist/server/require-hook.js` — the first thing the emitted `server.js`
loads — resolves that package through its `exports` map to the **ESM** build, so
the bundle holds a real `@swc/helpers` directory that cannot answer the one
request ever made of it. `next.config.ts` therefore names it in
`outputFileTracingIncludes`.

**Two things it is not**, both tested rather than reasoned about:

- **Not pnpm's linker.** The isolated `node_modules` layout looks like the
  culprit — the error path runs through `.pnpm/next@…/node_modules/@swc/helpers`
  — and installing that stage flat with `node-linker=hoisted` changes the shape
  of the bundle without fixing anything. Removing the hoisting after the tracing
  fix landed still boots and serves. If you are about to reach for
  `node-linker`, this is the note saying it was already tried.
- **Not a missing package.** `require('next/dist/server/require-hook.js')`
  succeeds in the broken image. Every check short of starting the server agrees
  the image is fine, which is why the Dockerfile now starts it.

**The guard.** `docker/web.Dockerfile` boots the bundle and fetches `/` as its
last build step, and fails the build on anything but a 200. That is deliberately
heavier than a resolve check: a resolve check is exactly what passed while the
image was broken.
