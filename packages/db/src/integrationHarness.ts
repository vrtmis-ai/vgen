import postgres, { type Sql } from "postgres";

export const TEST_DATABASE_URL = process.env.DATABASE_URL ?? "postgres://vgen:vgen-local@127.0.0.1:5442/vgen";

/** 1 credit, in the micro-credits every money column stores. */
export const COIN = 1_000_000;

export function connect(): Sql {
  return postgres(TEST_DATABASE_URL, { max: 1 });
}

const ROLLBACK = Symbol("integration-harness-rollback");

/**
 * Runs a test body against the migrated database inside a transaction that is
 * always rolled back.
 *
 * These tests used to apply the migrations into a throwaway schema and drop it
 * afterwards. That stopped being possible: 0006 rebuilds two tables as
 * partitioned, 0008 registers pg_cron jobs, and 0007 creates roles — all of them
 * database-wide, none of them relocatable behind a search_path.
 *
 * Rolling back is also stricter than dropping a schema, because tests share one
 * database and any row that escaped would be visible to the next one.
 */
export async function inRollback<T>(sql: Sql, run: (tx: Sql) => Promise<T>): Promise<T> {
  try {
    return await sql.begin(async (tx) => {
      const value = await run(tx as unknown as Sql);
      // The only way to make postgres.js roll back a successful body. The
      // marker distinguishes it from a genuine failure below.
      throw Object.assign(new Error("integration harness rollback"), { [ROLLBACK]: true, value });
    });
  } catch (error) {
    if (error && typeof error === "object" && ROLLBACK in error) return (error as unknown as { value: T }).value;
    throw error;
  }
}

type WithSavepoint = { savepoint: <T>(run: () => Promise<T>) => Promise<T> };

/**
 * Asserts that a statement is rejected by the database, and leaves the
 * surrounding transaction usable.
 *
 * `expect(...).rejects` is not enough on its own. A failed statement aborts the
 * whole Postgres transaction, so every later statement fails too — which both
 * loses the error you wanted (postgres.js rejects the enclosing `begin`) and
 * makes a run of consecutive rejection assertions pass for the wrong reason:
 * after the first one, they would all fail no matter what they tested.
 *
 * A SAVEPOINT scopes the damage, so each constraint is genuinely exercised.
 */
export async function expectDbError(tx: Sql, run: () => Promise<unknown>): Promise<Error> {
  try {
    await (tx as unknown as WithSavepoint).savepoint(async () => {
      await run();
    });
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error("Expected the database to reject this, but it succeeded");
}

/** An account with a user attached, which is what most reads are scoped by. */
export async function makeUser(tx: Sql): Promise<{ userId: string; accountId: string }> {
  const [account] = await tx<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
  const email = `harness-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  const [user] = await tx<{ id: string }[]>`
    insert into users (email, personal_account_id) values (${email}, ${account!.id}) returning id
  `;
  return { userId: user!.id, accountId: account!.id };
}
