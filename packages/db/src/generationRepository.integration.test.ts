import { readFile } from "node:fs/promises";
import postgres, { type Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresGenerationRepository, hashGenerationParams } from "./generationRepository";
import { PostgresOutboxDispatcher } from "./outbox";
import { PostgresWalletRepository } from "./walletRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5432/vgen";
const migrationUrls = [
  new URL("../migrations/0001_initial.sql", import.meta.url),
  new URL("../migrations/0002_clerk_auth.sql", import.meta.url),
  new URL("../migrations/0003_frontend_error_reports.sql", import.meta.url),
  new URL("../migrations/0004_outbox_retry.sql", import.meta.url),
];
const schemaName = `generation_test_${process.pid}_${Date.now()}`;

let adminSql: Sql;
let appSql: Sql;
let catalogVersion: number;

beforeAll(async () => {
  adminSql = postgres(databaseUrl, { max: 1 });
  await adminSql`create extension if not exists pgcrypto`;
  await adminSql.unsafe(`create schema "${schemaName}"`);
  await adminSql.unsafe(`set search_path to "${schemaName}", public`);
  for (const migrationUrl of migrationUrls) await adminSql.unsafe(await readFile(migrationUrl, "utf8"));
  const [version] = await adminSql<{ id: number }[]>`
    insert into catalog_versions (note, published_at) values ('generation integration', now()) returning id
  `;
  if (!version) throw new Error("Generation catalog fixture was not created");
  catalogVersion = version.id;
  await adminSql`
    insert into models (catalog_version, key, family, kind, min_tier, spec)
    values (${version.id}, 'flux-test', 'flux', 'image', 1, '{}')
  `;
  await adminSql.unsafe("set search_path to public");
  appSql = postgres(databaseUrl, { max: 4, connection: { search_path: `${schemaName},public` } });
});

async function createFixture(credits = 100, quotedCredits = 30) {
  const [user] = await appSql<{ id: string }[]>`insert into users default values returning id`;
  if (!user) throw new Error("Generation user fixture was not created");
  await appSql`
    insert into credit_grants (user_id, kind, amount, expires_at)
    values (${user.id}, 'signup_gift', ${credits}, now() + interval '1 day')
  `;
  const [quote] = await appSql<{ id: string }[]>`
    insert into quotes (
      user_id, catalog_version, model_key, params_hash, provider_cost_usd_micros,
      sell_price_credits, exchange_rate_irr_per_usd, margin_usd_micros, expires_at
    ) values (
      ${user.id}, ${catalogVersion}, 'flux-test', ${hashGenerationParams({ prompt: "a city" })},
      1000, ${quotedCredits}, 600000, 500, now() + interval '5 minutes'
    ) returning id
  `;
  if (!quote) throw new Error("Quote fixture was not created");
  return { userId: user.id, quoteId: quote.id };
}

afterAll(async () => {
  await appSql.end();
  await adminSql.unsafe(`drop schema if exists "${schemaName}" cascade`);
  await adminSql.end();
});

describe("Postgres generation repository", () => {
  it("atomically reserves credits and creates one durable queued job", async () => {
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);
    const result = await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a city" },
      idempotencyKey: "generate:test-1",
    });

    expect(result).toMatchObject({ outcome: "created", job: { status: "queued", quotedCredits: 30 } });
    if (result.outcome !== "created") throw new Error("Generation job was not created");
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 70 });
    await expect(repository.getForUser(result.job.id, userId)).resolves.toMatchObject({ status: "queued", quotedCredits: 30 });
    await expect(repository.countPendingDispatches()).resolves.toBe(1);
  });

  it("replays the same idempotent request without reserving credits twice", async () => {
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);
    const input = { userId, quoteId, params: { prompt: "a city" }, idempotencyKey: "generate:retry" };

    const created = await repository.createQueued(input);
    const replayed = await repository.createQueued(input);

    expect(created).toMatchObject({ outcome: "created" });
    expect(replayed).toEqual({ outcome: "replayed", job: created.outcome === "created" ? created.job : undefined });
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 70 });
  });

  it("serializes concurrent retries into one job and one credit hold", async () => {
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);
    const input = { userId, quoteId, params: { prompt: "a city" }, idempotencyKey: "generate:concurrent" };

    const results = await Promise.all([repository.createQueued(input), repository.createQueued(input)]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["created", "replayed"]);
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 70 });
  });

  it("does not create a job or outbox event when credits are insufficient", async () => {
    const { userId, quoteId } = await createFixture(10, 30);
    const repository = new PostgresGenerationRepository(appSql);
    const before = await repository.countPendingDispatches();

    const result = await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a city" },
      idempotencyKey: "generate:insufficient",
    });

    expect(result).toEqual({ outcome: "insufficient_credits" });
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 10 });
    await expect(repository.countPendingDispatches()).resolves.toBe(before);
  });

  it("rejects an expired quote without reserving credits", async () => {
    const { userId, quoteId } = await createFixture();
    await appSql`update quotes set expires_at = now() - interval '1 second' where id = ${quoteId}`;
    const repository = new PostgresGenerationRepository(appSql);

    const result = await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a city" },
      idempotencyKey: "generate:expired",
    });

    expect(result).toEqual({ outcome: "quote_expired" });
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 100 });
  });

  it("rejects parameters that differ from the authoritative quote", async () => {
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);

    const result = await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a different city" },
      idempotencyKey: "generate:params-mismatch",
    });

    expect(result).toEqual({ outcome: "params_mismatch" });
    await expect(new PostgresWalletRepository(appSql).getCurrent(userId)).resolves.toMatchObject({ spendable: 100 });
  });

  it("marks an outbox event published only after the queue acknowledges it", async () => {
    await appSql`update outbox set published_at = now() where published_at is null`;
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);
    const created = await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a city" },
      idempotencyKey: "generate:dispatch",
    });
    if (created.outcome !== "created") throw new Error("Dispatch fixture was not created");
    const published: unknown[] = [];
    const dispatcher = new PostgresOutboxDispatcher(appSql);

    await expect(dispatcher.dispatchBatch({ publish: async (event) => void published.push(event) })).resolves.toEqual({
      published: 1,
      failed: 0,
    });

    expect(published).toEqual([
      expect.objectContaining({ aggregateId: created.job.id, eventType: "generation.requested", payload: { jobId: created.job.id } }),
    ]);
    await expect(repository.countPendingDispatches()).resolves.toBe(0);
    await expect(dispatcher.dispatchBatch({ publish: async (event) => void published.push(event) })).resolves.toEqual({
      published: 0,
      failed: 0,
    });
    expect(published).toHaveLength(1);
  });

  it("keeps a failed publication pending and applies retry backoff", async () => {
    await appSql`update outbox set published_at = now() where published_at is null`;
    const { userId, quoteId } = await createFixture();
    const repository = new PostgresGenerationRepository(appSql);
    await repository.createQueued({
      userId,
      quoteId,
      params: { prompt: "a city" },
      idempotencyKey: "generate:dispatch-failure",
    });
    const dispatcher = new PostgresOutboxDispatcher(appSql);

    await expect(dispatcher.dispatchBatch({ publish: async () => Promise.reject(new Error("redis offline")) })).resolves.toEqual({
      published: 0,
      failed: 1,
    });

    await expect(repository.countPendingDispatches()).resolves.toBe(1);
    await expect(dispatcher.dispatchBatch({ publish: async () => undefined })).resolves.toEqual({ published: 0, failed: 0 });
  });
});
