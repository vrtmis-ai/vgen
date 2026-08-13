import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresWalletRepository } from "./walletRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const clerkMigrationUrl = new URL("../migrations/0002_clerk_auth.sql", import.meta.url);
const schemaName = `wallet_repository_test_${process.pid}_${Date.now()}`;

let adminSql: Sql;
let appSql: Sql;

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

describe("Postgres wallet repository", () => {
  it("projects only spendable grants and reports the next expiry", async () => {
    const [user] = await appSql<{ id: string }[]>`insert into users default values returning id`;
    if (!user) throw new Error("Wallet test user was not created");
    const [expiring] = await appSql<{ id: string }[]>`
      insert into credit_grants (user_id, kind, amount, consumed, granted_at, expires_at)
      values (${user.id}, 'signup_gift', 12, 2, now() - interval '1 day', now() + interval '2 days')
      returning id
    `;
    await appSql`
      insert into credit_grants (user_id, kind, amount, consumed, granted_at, expires_at)
      values
        (${user.id}, 'reward', 8, 3, now(), null),
        (${user.id}, 'plan', 7, 0, now(), now() - interval '1 minute'),
        (${user.id}, 'admin', 4, 4, now(), now() + interval '3 days')
    `;

    const wallet = await new PostgresWalletRepository(appSql).getCurrent(user.id);

    expect(wallet.spendable).toBe(15);
    expect(wallet.grants).toHaveLength(2);
    expect(wallet.grants[0]).toMatchObject({ id: expiring!.id, kind: "signup_gift", coinsGranted: 12, coinsRemaining: 10 });
    expect(wallet.grants[0]!.expiresAt).toBeTypeOf("number");
    expect(wallet.grants[1]).toMatchObject({ kind: "reward", coinsGranted: 8, coinsRemaining: 5 });
    expect(wallet.grants[1]).not.toHaveProperty("expiresAt");
    expect(wallet.nextExpiry).toEqual({ at: wallet.grants[0]!.expiresAt, coins: 10 });
  });
});
