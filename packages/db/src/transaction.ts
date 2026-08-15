import type { Sql, TransactionSql } from "postgres";

export type Atomically = <T>(run: (tx: TransactionSql) => Promise<T>) => Promise<T>;

/**
 * Runs a block atomically, whether or not the caller already has a transaction
 * open.
 *
 * postgres.js puts `begin` on a connection and `savepoint` on a transaction,
 * and neither has the other — so a repository that hardcodes `begin` throws the
 * moment it is called inside someone else's transaction. Picking between them
 * lets these compose: signup inside a larger unit of work, and every
 * integration test inside a rollback.
 */
export function atomically(sql: Sql): Atomically {
  const handle = sql as unknown as { begin?: Atomically; savepoint?: Atomically };
  const runner = handle.begin ?? handle.savepoint;
  if (!runner) throw new Error("The SQL handle supports neither begin() nor savepoint()");
  return runner.bind(handle) as Atomically;
}
