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
