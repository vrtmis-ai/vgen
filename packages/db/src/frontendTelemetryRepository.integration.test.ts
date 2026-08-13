import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresFrontendTelemetryRepository } from "./frontendTelemetryRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";
const migrationUrls = [
  new URL("../migrations/0001_initial.sql", import.meta.url),
  new URL("../migrations/0002_clerk_auth.sql", import.meta.url),
  new URL("../migrations/0003_frontend_error_reports.sql", import.meta.url),
];
const schemaName = `frontend_telemetry_test_${process.pid}_${Date.now()}`;

let adminSql: Sql;
let appSql: Sql;

beforeAll(async () => {
  adminSql = postgres(databaseUrl, { max: 1 });
  await adminSql`create extension if not exists pgcrypto`;
  await adminSql.unsafe(`create schema "${schemaName}"`);
  await adminSql.unsafe(`set search_path to "${schemaName}", public`);
  for (const migrationUrl of migrationUrls) await adminSql.unsafe(await readFile(migrationUrl, "utf8"));
  await adminSql.unsafe("set search_path to public");
  appSql = postgres(databaseUrl, { max: 1, connection: { search_path: `${schemaName},public` } });
});

afterAll(async () => {
  await appSql.end();
  await adminSql.unsafe(`drop schema if exists "${schemaName}" cascade`);
  await adminSql.end();
});

describe("Postgres frontend telemetry repository", () => {
  it("records and reads back only sanitized operational context", async () => {
    const repository = new PostgresFrontendTelemetryRepository(appSql);
    const reportId = await repository.record({
      type: "frontend_crash",
      release: "2026.08.12",
      host: "web",
      route: "/generate/seedance",
      code: "provider_unavailable",
      requestId: "req-7",
      occurredAt: 123,
    });

    expect(reportId).toMatch(/^\d+$/);
    await expect(repository.listRecent(10)).resolves.toEqual([
      expect.objectContaining({
        id: reportId,
        release: "2026.08.12",
        route: "/generate/seedance",
        code: "provider_unavailable",
        requestId: "req-7",
      }),
    ]);
  });
});
