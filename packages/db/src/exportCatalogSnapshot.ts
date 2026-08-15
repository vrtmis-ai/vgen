// Write what the database serves as the catalog to src/data/catalog.snapshot.json.
//
// Demo mode has to work with no backend, so it needs the catalog in the bundle.
// It used to import FAMILIES directly, which meant demo mode and production
// were reading two different things and only one of them was the thing being
// shipped — the seeder could lose a control in translation and demo mode would
// keep rendering it perfectly.
//
// So the fixture is generated from Postgres instead, through the same
// repository the API serves from, and committed. CI reseeds, re-exports and
// diffs; a difference means FAMILIES -> seeder -> provider_models -> snapshot
// stopped round-tripping, which is exactly the failure nothing else would show.
//
// `version` and `publishedAt` are deliberately not written. They derive from
// row timestamps, so including them would make the file differ on every run and
// the diff would stop meaning anything. Demo mode supplies its own.
//
// Run: pnpm catalog:snapshot   (needs DATABASE_URL, and a seeded database)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { PostgresCatalogRepository } from "./catalogRepository";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to export the catalog snapshot");

const target = new URL("../../../src/data/catalog.snapshot.json", import.meta.url);
const sql = postgres(databaseUrl, { max: 1 });

try {
  const snapshot = await new PostgresCatalogRepository(sql).list();
  if (snapshot.families.length === 0) {
    throw new Error("the database has no active models — run `pnpm catalog:publish` first");
  }

  await writeFile(target, `${JSON.stringify({ families: snapshot.families }, null, 2)}\n`, "utf8");
  const variants = snapshot.families.reduce((count, family) => count + family.variants.length, 0);
  console.log(`wrote ${snapshot.families.length} families and ${variants} variants to src/data/catalog.snapshot.json`);
} finally {
  await sql.end();
}
