import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresCatalogRepository } from "./catalogRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const clerkMigrationUrl = new URL("../migrations/0002_clerk_auth.sql", import.meta.url);
const schemaName = `catalog_repository_test_${process.pid}_${Date.now()}`;

let adminSql: Sql;
let appSql: Sql;

const family = (id: string, name: string) => ({
  id,
  name,
  vendor: "DEEV Test",
  kind: "image" as const,
  blurb: `${name} description`,
  grad: "linear-gradient(135deg,#111,#333)",
  controls: [],
  variants: [{ id: `${id}-v1`, model: `${id}/v1`, label: "v1" }],
});

beforeAll(async () => {
  adminSql = postgres(databaseUrl, { max: 1 });
  await adminSql`create extension if not exists pgcrypto`;
  await adminSql.unsafe(`create schema "${schemaName}"`);
  await adminSql.unsafe(`set search_path to "${schemaName}", public`);
  await adminSql.unsafe(await readFile(migrationUrl, "utf8"));
  await adminSql.unsafe(await readFile(clerkMigrationUrl, "utf8"));
  await adminSql.unsafe("set search_path to public");
  appSql = postgres(databaseUrl, { max: 1, connection: { search_path: `${schemaName},public` } });
});

afterAll(async () => {
  await appSql.end();
  await adminSql.unsafe(`drop schema if exists "${schemaName}" cascade`);
  await adminSql.end();
});

describe("Postgres catalog repository", () => {
  it("returns the bootstrap snapshot when nothing is published", async () => {
    await appSql`insert into catalog_versions (note) values ('draft only')`;

    await expect(new PostgresCatalogRepository(appSql).list()).resolves.toEqual({
      version: "bootstrap-v1",
      publishedAt: 0,
      families: [],
    });
  });

  it("returns active families from the latest published version", async () => {
    const [older] = await appSql<{ id: number }[]>`
      insert into catalog_versions (published_at, note) values (now() - interval '1 day', 'old') returning id
    `;
    const [latest] = await appSql<{ id: number; published_at: Date }[]>`
      insert into catalog_versions (published_at, note) values (now(), 'latest') returning id, published_at
    `;
    if (!older || !latest) throw new Error("Catalog versions were not created");
    await appSql`
      insert into models (catalog_version, key, family, kind, min_tier, spec, active)
      values
        (${older.id}, 'old', 'old', 'image', 1, ${appSql.json(family("old", "Old"))}, true),
        (${latest.id}, 'beta', 'beta', 'image', 1, ${appSql.json(family("beta", "Beta"))}, true),
        (${latest.id}, 'alpha', 'alpha', 'image', 1, ${appSql.json(family("alpha", "Alpha"))}, true),
        (${latest.id}, 'hidden', 'hidden', 'image', 1, ${appSql.json(family("hidden", "Hidden"))}, false)
    `;

    const snapshot = await new PostgresCatalogRepository(appSql).list();

    expect(snapshot.version).toBe(`catalog-${latest.id}`);
    expect(snapshot.publishedAt).toBe(latest.published_at.getTime());
    expect(snapshot.families.map((item) => item.id)).toEqual(["alpha", "beta"]);
  });
});
