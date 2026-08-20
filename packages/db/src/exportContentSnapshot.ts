// Write what the database serves as the content to src/data/content.snapshot.json.
//
// The same argument as exportCatalogSnapshot, applied to the seven collections
// that used to be TypeScript constants: demo mode has to work with no backend,
// so it needs them in the bundle. Importing PRESETS and COURSES directly is
// what this replaces — that made demo mode and production two different
// readings of the same content, and only one of them was the one shipping.
//
// So the fixture is generated from Postgres through the same repository the API
// serves from, and committed. CI reseeds, re-exports and diffs; a difference
// means content.rows.json -> content_items -> snapshot stopped round-tripping.
//
// `version` and `publishedAt` are deliberately not written — they derive from
// row timestamps, so including them would make the file differ on every run and
// the diff would stop meaning anything. Demo mode supplies its own.
//
// Run: pnpm content:snapshot   (needs DATABASE_URL, and a seeded database)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { PostgresContentRepository } from "./contentRepository";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to export the content snapshot");

const target = new URL("../../../src/data/content.snapshot.json", import.meta.url);
const sql = postgres(databaseUrl, { max: 1 });

try {
  const { version: _version, publishedAt: _publishedAt, ...collections } = await new PostgresContentRepository(sql).list();
  const total = Object.values(collections).reduce((count, rows) => count + rows.length, 0);
  if (total === 0) throw new Error("the database has no published content — run `pnpm content:publish` first");

  await writeFile(target, `${JSON.stringify(collections, null, 2)}\n`, "utf8");
  const summary = Object.entries(collections)
    .map(([name, rows]) => `${rows.length} ${name}`)
    .join(", ");
  console.log(`wrote ${summary} to src/data/content.snapshot.json`);
} finally {
  await sql.end();
}
