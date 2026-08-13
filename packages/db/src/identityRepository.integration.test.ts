import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CustomerIdentityConflictError, PostgresCustomerRepository } from "./identityRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";
const migrationUrl = new URL("../migrations/0001_initial.sql", import.meta.url);
const clerkMigrationUrl = new URL("../migrations/0002_clerk_auth.sql", import.meta.url);
const schemaName = `clerk_identity_test_${process.pid}_${Date.now()}`;

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

describe("Postgres Clerk customer repository", () => {
  it("creates exactly one 12-credit signup gift with a 14-day lifetime", async () => {
    const repository = new PostgresCustomerRepository(appSql);
    const before = Date.now();
    const first = await repository.syncClerkUser({
      clerkUserId: "user_clerk_signup_gift",
      emailNormalized: "gift@example.com",
      displayName: "Gift user",
      avatarUrl: null,
    });
    await repository.syncClerkUser({
      clerkUserId: "user_clerk_signup_gift",
      emailNormalized: "gift@example.com",
      displayName: "Gift user",
      avatarUrl: null,
    });
    const after = Date.now();

    const grants = await appSql<{ id: string; amount: string; consumed: string; kind: string; granted_at: Date; expires_at: Date }[]>`
      select id, amount, consumed, kind, granted_at, expires_at
      from credit_grants
      where user_id = ${first.id}
    `;
    const ledger = await appSql<{ grant_id: string; delta: string; reason: string; idempotency_key: string }[]>`
      select grant_id, delta, reason, idempotency_key
      from credit_ledger
      where user_id = ${first.id}
    `;

    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ amount: "12", consumed: "0", kind: "signup_gift" });
    expect(grants[0]!.expires_at.getTime() - grants[0]!.granted_at.getTime()).toBe(14 * 24 * 60 * 60 * 1000);
    expect(grants[0]!.granted_at.getTime()).toBeGreaterThanOrEqual(before);
    expect(grants[0]!.granted_at.getTime()).toBeLessThanOrEqual(after);
    expect(ledger).toEqual([
      {
        grant_id: grants[0]!.id,
        delta: "12",
        reason: "grant_signup_gift",
        idempotency_key: "signup_gift:v1",
      },
    ]);
  });

  it("backfills the signup gift for a Clerk identity created before the gift existed", async () => {
    const [user] = await appSql<{ id: string }[]>`insert into users default values returning id`;
    if (!user) throw new Error("Legacy user was not created");
    await appSql`
      insert into identities (user_id, provider, subject, verified_at)
      values
        (${user.id}, 'clerk', 'user_clerk_legacy', now()),
        (${user.id}, 'email', 'legacy@example.com', now())
    `;

    await new PostgresCustomerRepository(appSql).syncClerkUser({
      clerkUserId: "user_clerk_legacy",
      emailNormalized: "legacy@example.com",
      displayName: null,
      avatarUrl: null,
    });

    const counts = await appSql<{ count: string }[]>`
      select count(*) from credit_ledger where user_id = ${user.id} and idempotency_key = 'signup_gift:v1'
    `;
    expect(counts[0]?.count).toBe("1");
  });

  it("maps repeated Clerk sessions to one internal Vgen user", async () => {
    const repository = new PostgresCustomerRepository(appSql);
    const first = await repository.syncClerkUser({
      clerkUserId: "user_clerk_123",
      emailNormalized: "person@example.com",
      displayName: "First name",
      avatarUrl: null,
    });
    const second = await repository.syncClerkUser({
      clerkUserId: "user_clerk_123",
      emailNormalized: "person@example.com",
      displayName: "Updated name",
      avatarUrl: "https://example.com/avatar.png",
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      emailNormalized: "person@example.com",
      displayName: "Updated name",
      avatarUrl: "https://example.com/avatar.png",
      methods: ["email"],
    });
  });

  it("never merges two Clerk users that claim the same verified email", async () => {
    const repository = new PostgresCustomerRepository(appSql);
    await repository.syncClerkUser({
      clerkUserId: "user_clerk_owner",
      emailNormalized: "owned@example.com",
      displayName: null,
      avatarUrl: null,
    });

    await expect(
      repository.syncClerkUser({
        clerkUserId: "user_clerk_attacker",
        emailNormalized: "owned@example.com",
        displayName: null,
        avatarUrl: null,
      }),
    ).rejects.toBeInstanceOf(CustomerIdentityConflictError);
  });
});
