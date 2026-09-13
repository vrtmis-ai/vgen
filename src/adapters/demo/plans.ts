import type { AppServices } from "../../runtime/AppServices";
import { PLAN_LADDER } from "../../data/planLadder";
import { SEED_TOMAN_PER_USD } from "../../data/plans";

/**
 * The ladder demo mode serves — the database's own export, not the seed file
 * beside it.
 *
 * Same rule the demo catalog follows, for the same reason: `plans.rows.json` is
 * the input a human edits and `plans.snapshot.json` is what Postgres hands back
 * after seeding. Serving the input here would mean demo mode renders one
 * document while production renders the other, and a field the seeder drops
 * would look perfect in the mode the screen was built in.
 *
 * Regenerate with `pnpm plans:publish && pnpm plans:snapshot`.
 */
export function createDemoPlansService(): AppServices["plans"] {
  // Demo mode has no `fx_rates` to read, so it quotes the seed rate — the same
  // number an unseeded database would start from. Prices here are illustrative
  // and nothing in this mode reaches a gateway.
  return { list: async () => ({ plans: PLAN_LADDER, tomanPerUsd: SEED_TOMAN_PER_USD }) };
}
