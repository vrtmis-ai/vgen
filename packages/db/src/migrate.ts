import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../../.env.development.local", import.meta.url)), quiet: true });
config({ path: fileURLToPath(new URL("../../../.env.local", import.meta.url)), quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const sql = postgres(databaseUrl, { max: 1 });
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));

try {
  await sql`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  const files = (await readdir(migrationsDirectory)).filter((name) => /^\d+.*\.sql$/.test(name)).sort();
  for (const name of files) {
    const [applied] = await sql<{ exists: boolean }[]>`select exists(select 1 from schema_migrations where name = ${name}) as exists`;
    if (applied?.exists) continue;
    const migration = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await sql.begin(async (transaction) => {
      await transaction.unsafe(migration);
      await transaction`insert into schema_migrations (name) values (${name})`;
    });
    console.log(`applied ${name}`);
  }
} finally {
  await sql.end();
}
