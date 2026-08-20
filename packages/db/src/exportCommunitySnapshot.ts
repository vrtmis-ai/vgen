// Write what the database serves as the community feed to
// src/data/community.snapshot.json.
//
// Same argument as the catalog and content fixtures beside it: demo mode has to
// work with no backend, and reading the seeder's input rather than its output
// would mean demo mode renders one thing while production renders another.
//
// The ids here are real uuids from the seeded rows, so this file changes if the
// rows are recreated. That is the intended signal — a recreated feed IS a
// different feed — and it is why the seeder never deletes and reinserts.
//
// Run: pnpm community:snapshot   (needs DATABASE_URL, and a seeded database)

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import postgres from "postgres";
import { PostgresCommunityRepository } from "./communityRepository";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to export the community snapshot");

const target = new URL("../../../src/data/community.snapshot.json", import.meta.url);
const sql = postgres(databaseUrl, { max: 1 });

try {
  const feed = await new PostgresCommunityRepository(sql).list();
  if (feed.posts.length === 0) throw new Error("the database has no approved posts — run `pnpm community:publish` first");

  await writeFile(target, `${JSON.stringify(feed, null, 2)}\n`, "utf8");
  console.log(`wrote ${feed.posts.length} posts to src/data/community.snapshot.json`);
} finally {
  await sql.end();
}
