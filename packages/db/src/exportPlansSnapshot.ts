/**
 * Write what the database serves to `src/data/plans.snapshot.json`.
 *
 * The committed file is what demo mode and the Plans screen read, so this is
 * what keeps "the card renders offline" and "the card matches what we bill"
 * from being two different documents. CI reseeds, re-exports and diffs; a
 * difference means the table and the screen disagree about what a plan costs.
 *
 * Run: pnpm plans:snapshot   (needs DATABASE_URL)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { PostgresPlansRepository } from "./plansRepository";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to export the plans snapshot");

const sql = postgres(databaseUrl, { max: 1 });

try {
  const plans = await new PostgresPlansRepository(sql).list();
  // An empty ladder is a database that has not been seeded, not a product with
  // no plans. Writing it would commit the emptiness and take the Plans screen
  // down with it.
  if (plans.length === 0) {
    throw new Error("the database has no public plans; run pnpm plans:publish first");
  }

  const target = fileURLToPath(new URL("../../../src/data/plans.snapshot.json", import.meta.url));
  writeFileSync(target, `${JSON.stringify({ plans }, null, 2)}\n`, "utf8");
  console.log(`wrote ${plans.length} plans to src/data/plans.snapshot.json`);
} finally {
  await sql.end();
}
