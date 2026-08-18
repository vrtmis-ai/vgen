import { PlanListSchema, type Plan } from "../runtime/contracts/plans";
import snapshot from "./plans.snapshot.json";

/**
 * The committed plan ladder — the database's own export, for the callers that
 * have no database to ask.
 *
 * A module of its own rather than a constant in `plans.ts`, because `plans.ts`
 * is in the production bundle: every screen imports its Toman conversion and
 * its estimates. Parsing a JSON file at module scope from there would put a
 * throw before React mounts on a code path that does not even use the file —
 * production reads `GET /plans` — and produce exactly the blank screen the
 * plan audit was pulled out of module evaluation to avoid.
 *
 * Three callers, none of them a screen: the demo adapter, which serves this as
 * its `GET /plans`; `scripts/check-combos.ts`, which audits it in CI; and the
 * tests, which need a realistic ladder to hand a provider.
 *
 * `plans.rows.json` beside it is the seeder's input. Both are generated —
 * `pnpm plans:publish && pnpm plans:snapshot` — and neither is hand-edited.
 */
export const PLAN_LADDER: Plan[] = PlanListSchema.parse(snapshot).plans;
