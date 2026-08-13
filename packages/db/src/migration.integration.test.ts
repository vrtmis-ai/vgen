import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";

/* Read the directory, the way migrate.ts does — this was a hardcoded list of
   0001..0004, and a hardcoded list silently stops testing the schema that
   actually ships. Adding 0005 was enough to expose it: the migration was
   applied to the real database and provably worked there, while this test built
   a schema without it and reported the guarantee as absent. The failure mode is
   worse in the other direction, where a migration lands, nobody adds it here,
   and the suite keeps passing against a schema no environment runs.

   Same filter and sort as the runner, so the two cannot disagree about order. */
const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
const migrationUrls = (await readdir(migrationsDirectory))
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort()
  .map((name) => new URL(`../migrations/${name}`, import.meta.url));
const schemaName = `migration_test_${process.pid}_${Date.now()}`;

let sql: Sql;
let userId: string;
let catalogVersion: number;

async function expectDatabaseError(statement: string, code: string) {
  await sql.unsafe("savepoint expected_failure");
  try {
    await sql.unsafe(statement);
    throw new Error(`Expected PostgreSQL error ${code}`);
  } catch (error) {
    await sql.unsafe("rollback to savepoint expected_failure");
    expect(error).toMatchObject({ code });
  } finally {
    await sql.unsafe("release savepoint expected_failure");
  }
}

async function createQuote(): Promise<string> {
  const [quote] = await sql<{ id: string }[]>`
    insert into quotes (
      user_id, catalog_version, model_key, params_hash,
      provider_cost_usd_micros, sell_price_credits,
      exchange_rate_irr_per_usd, margin_usd_micros, expires_at
    ) values (
      ${userId}, ${catalogVersion}, 'flux-test', ${new Uint8Array([1])},
      1000, 10, 600000, 500, now() + interval '5 minutes'
    ) returning id
  `;
  if (!quote) throw new Error("Quote fixture was not created");
  return quote.id;
}

beforeAll(async () => {
  sql = postgres(databaseUrl, { max: 1 });
  await sql.unsafe("create extension if not exists pgcrypto");
  await sql.unsafe("begin");
  await sql.unsafe(`create schema "${schemaName}"`);
  await sql.unsafe(`set local search_path to "${schemaName}", public`);
  for (const migrationUrl of migrationUrls) await sql.unsafe(await readFile(migrationUrl, "utf8"));

  const [user] = await sql<{ id: string }[]>`insert into users default values returning id`;
  const [version] = await sql<{ id: number }[]>`insert into catalog_versions (note) values ('integration') returning id`;
  if (!user || !version) throw new Error("Migration fixtures were not created");
  userId = user.id;
  catalogVersion = version.id;
  await sql`
    insert into models (catalog_version, key, family, kind, min_tier, spec)
    values (${catalogVersion}, 'flux-test', 'flux', 'image', 1, '{}')
  `;
});

afterAll(async () => {
  await sql.unsafe("rollback");
  await sql.end();
});

describe("database migration chain", () => {
  it("reapplies cleanly after a transactional rollback", async () => {
    const replay = postgres(databaseUrl, { max: 1 });
    const migrations = await Promise.all(migrationUrls.map((migrationUrl) => readFile(migrationUrl, "utf8")));

    try {
      for (const suffix of ["first", "second"]) {
        const replaySchema = `${schemaName}_${suffix}`;
        await replay.unsafe("begin");
        await replay.unsafe(`create schema "${replaySchema}"`);
        await replay.unsafe(`set local search_path to "${replaySchema}", public`);
        for (const migration of migrations) await replay.unsafe(migration);
        const [result] = await replay<{ count: string }[]>`
          select count(*)::text as count
          from information_schema.tables
          where table_schema = ${replaySchema}
        `;
        expect(Number(result?.count)).toBeGreaterThan(20);
        await replay.unsafe("rollback");
      }
    } finally {
      await replay.end();
    }
  });

  it("uses integer storage for every money and credit column", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = ${schemaName}
        and (
          column_name like '%_credits'
          or column_name like '%_usd_micros'
          or column_name like '%_irr'
          or column_name in ('amount', 'consumed', 'delta', 'credits')
        )
    `;

    expect(columns.length).toBeGreaterThan(10);
    expect(columns.every((column) => column.data_type === "bigint")).toBe(true);
  });

  it("enforces append-only financial and admin audit records", async () => {
    const [grant] = await sql<{ id: string }[]>`
      insert into credit_grants (user_id, kind, amount) values (${userId}, 'admin', 100) returning id
    `;
    if (!grant) throw new Error("Grant fixture was not created");
    await sql`
      insert into credit_ledger (user_id, grant_id, delta, reason, idempotency_key)
      values (${userId}, ${grant.id}, 100, 'grant_admin', 'grant:test')
    `;
    await expectDatabaseError("update credit_ledger set delta = 200", "55000");

    const [admin] = await sql<{ id: string }[]>`
      insert into admin_users (email, role, totp_secret) values ('owner@example.test', 'owner', decode('00', 'hex')) returning id
    `;
    if (!admin) throw new Error("Admin fixture was not created");
    await sql`insert into admin_audit_log (admin_id, action) values (${admin.id}, 'schema.test')`;
    await expectDatabaseError("delete from admin_audit_log", "55000");

    await sql`
      insert into frontend_error_reports (type, release, host, route, code, occurred_at)
      values ('frontend_crash', 'test', 'web', '/studio/video', 'render_error', now())
    `;
    await expectDatabaseError("delete from frontend_error_reports", "55000");

    /* TRUNCATE, which used to be the way through all of the above.
       It is a separate privilege from delete, and BEFORE ... FOR EACH ROW
       triggers never fire for it because it touches no rows — so every table
       here was protected against the careful mistake and open to the blunt one.
       0005 adds statement-level triggers; these assertions are what stop that
       regressing. */
    await expectDatabaseError("truncate credit_ledger cascade", "55000");
    await expectDatabaseError("truncate admin_audit_log cascade", "55000");
    await expectDatabaseError("truncate job_events cascade", "55000");
    await expectDatabaseError("truncate config_history cascade", "55000");
    await expectDatabaseError("truncate frontend_error_reports cascade", "55000");
  });

  it("rejects duplicate job, provider task, webhook and ledger operations", async () => {
    const quoteA = await createQuote();
    const quoteB = await createQuote();
    await sql`
      insert into jobs (
        user_id, quote_id, status, catalog_version, model_key, params, params_hash,
        idempotency_key, quoted_credits, held_credits, provider, provider_task_id
      ) values (
        ${userId}, ${quoteA}, 'queued', ${catalogVersion}, 'flux-test', '{}', ${new Uint8Array([1])},
        'job:test', 10, 10, 'kie', 'provider-task-1'
      )
    `;
    await expectDatabaseError(
      `insert into jobs (user_id, quote_id, status, catalog_version, model_key, params, params_hash, idempotency_key, quoted_credits, held_credits)
       values ('${userId}', '${quoteB}', 'queued', ${catalogVersion}, 'flux-test', '{}', decode('01','hex'), 'job:test', 10, 10)`,
      "23505",
    );

    await sql`insert into webhook_deliveries (provider, external_id, timestamp_s, accepted) values ('kie', 'event-1', 1, true)`;
    await expectDatabaseError(
      "insert into webhook_deliveries (provider, external_id, timestamp_s, accepted) values ('kie', 'event-1', 1, true)",
      "23505",
    );
    await expectDatabaseError(
      `insert into credit_ledger (user_id, delta, reason, idempotency_key) values ('${userId}', 1, 'grant_admin', 'grant:test')`,
      "23505",
    );
  });

  it("rejects invalid negative financial values", async () => {
    await expectDatabaseError(`insert into credit_grants (user_id, kind, amount) values ('${userId}', 'admin', -1)`, "23514");
  });
});
