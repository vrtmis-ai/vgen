# Known flaky tests

A test that fails on a pull request which did not touch it costs somebody an
hour of looking for a bug that is not there — and the second time it happens,
it costs the suite its credibility. This page is where a diagnosed flake goes
so the next person recognises it instead of re-deriving it.

**A flake is not "a test that sometimes fails". It is a test whose failure
carries no information about the change under review.** If the mechanism is not
written down here, treat a red check as real.

---

## `packages/db` · `analyticsRepository.integration.test.ts`

> `the overview > counts what happened in the window and ignores what did not`
> — `AssertionError: expected 2 to be 1` at line 79

**Owner: backend.** Reported by the frontend side; not fixed here because
`packages/db/` is not ours to change.

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
  single transaction that rolls back. Its `afterAll` closes the pool without
  deleting those rows.

Run in parallel, a job committed by the second between the first's two reads
makes the delta 2.

### It is not only a test problem

The committed rows stay in the database. On 2026-08-24 a local database had
**203 of its 210 `plans` rows** left behind by that test — seven of them
`is_active and is_public`, so `GET /plans` was serving `Race Test Plan` to the
web tier alongside the seven real ones. `pnpm plans:publish` retires them,
because the publisher deactivates any plan absent from the source file, but
nothing runs it automatically after a test run.

### Options, for whoever picks it up

|                                                                        | cost                                                                        |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `fileParallelism: false` in `packages/db/vitest.integration.config.ts` | proven (8/8 clean); suite goes 2s → 5s                                      |
| run the concurrency file in its own project, sequenced after the rest  | cleanest; needs a two-project config                                        |
| scope `overview()` to an account                                       | most correct; changes an API                                                |
| delete the committed rows in `afterAll`                                | narrows the window, does not close it — the commits happen _during_ the run |

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
