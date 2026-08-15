import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COIN, connect, expectDbError, inRollback, makeUser } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

const EXPECTED_MIGRATIONS = [
  "0001_schema.sql",
  "0002_commerce.sql",
  "0003_lifecycle.sql",
  "0004_reconciliation.sql",
  "0005_security.sql",
  "0006_partitioning.sql",
  "0007_hardening.sql",
  "0008_cron.sql",
  "0009_app_tables.sql",
  "0010_credit_functions.sql",
  "0011_access.sql",
  "0012_admin_sessions.sql",
  "0013_audit_immutable.sql",
];

describe("database migration chain", () => {
  it("records every migration exactly once, so a re-run is a no-op", async () => {
    const rows = await sql<{ name: string }[]>`select name from schema_migrations order by name`;
    expect(rows.map((row) => row.name)).toEqual(EXPECTED_MIGRATIONS);
  });

  it("stores the locale that makes Persian sort correctly", async () => {
    // Set by initdb and only by initdb. If this is ever not fa-IR, the cluster
    // was rebuilt without the right POSTGRES_INITDB_ARGS and every Persian
    // ORDER BY in the product is subtly wrong.
    const [row] = await sql<{ datlocprovider: string; datlocale: string | null }[]>`
      select datlocprovider::text, datlocale from pg_database where datname = current_database()
    `;
    expect(row?.datlocprovider).toBe("i");
    expect(row?.datlocale).toBe("fa-IR");
  });

  it("uses exact numeric storage for every money and credit column", async () => {
    // A float in the money path is a rounding error waiting to be reconciled.
    // Micro-credits are bigint; provider and retail currency are numeric.
    const rows = await sql<{ table_name: string; column_name: string; data_type: string }[]>`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and (
          column_name like '%micro_credits%'
          or column_name like '%_usd%'
          or column_name like '%amount%'
          or column_name like '%price%'
          or column_name like '%balance%'
        )
        and data_type in ('double precision', 'real')
    `;
    expect(rows).toEqual([]);
  });

  it("keeps the credit ledger append-only, including against TRUNCATE", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await tx`select grant_credits(${accountId}, 'purchase', ${5 * COIN}, null)`;

      const [before] = await tx<{ count: string }[]>`
        select count(*)::text as count from credit_ledger where account_id = ${accountId}
      `;
      expect(Number(before?.count)).toBe(1);

      // UPDATE and DELETE are rules that do nothing rather than errors — the
      // row simply survives. TRUNCATE is a trigger and does raise.
      await tx`update credit_ledger set micro_credits = 999 where account_id = ${accountId}`;
      await tx`delete from credit_ledger where account_id = ${accountId}`;
      const [after] = await tx<{ count: string; micro_credits: string }[]>`
        select count(*)::text as count, max(micro_credits)::text as micro_credits
        from credit_ledger where account_id = ${accountId}
      `;
      expect(Number(after?.count)).toBe(1);
      expect(Number(after?.micro_credits)).toBe(5 * COIN);
    });

    await expect(sql`truncate credit_ledger`).rejects.toThrow(/append-only/);
    await expect(sql`truncate audit_log`).rejects.toThrow(/append-only/);
  });

  it("rejects a second live hold on the same job", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);
      await tx`select grant_credits(${accountId}, 'purchase', ${50 * COIN}, null)`;
      const [job] = await tx<{ id: string }[]>`select uuid_generate_v7() as id`;

      await tx`select hold_credits(${accountId}, ${COIN}, 'job', ${job!.id})`;
      // The unique index is what makes a resubmitted generation idempotent
      // rather than double-charged.
      await expectDbError(tx, () => tx`select hold_credits(${accountId}, ${COIN}, 'job', ${job!.id})`);
    });
  });

  it("rejects duplicate idempotency keys and provider webhook events", async () => {
    await inRollback(sql, async (tx) => {
      const [provider] = await tx<{ id: string }[]>`
        insert into providers (code, name, base_url)
        values (${`p${Date.now()}`}, 'Test Provider', 'https://example.test')
        returning id
      `;
      await tx`
        insert into provider_webhook_events (provider_id, external_event_id, event_type, payload)
        values (${provider!.id}, 'evt-1', 'job.completed', '{}'::jsonb)
      `;
      await expectDbError(
        tx,
        () => tx`
          insert into provider_webhook_events (provider_id, external_event_id, event_type, payload)
          values (${provider!.id}, 'evt-1', 'job.completed', '{}'::jsonb)
        `,
      );
    });
  });

  it("rejects negative balances, lots and holds", async () => {
    await inRollback(sql, async (tx) => {
      const { accountId } = await makeUser(tx);

      // Each inside its own savepoint, so all four constraints are genuinely
      // exercised rather than three of them inheriting the first one's failure.
      await expectDbError(tx, () => tx`insert into account_balances (account_id, micro_credits) values (${accountId}, -1)`);
      await expectDbError(
        tx,
        () => tx`
          insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining)
          values (${accountId}, 'purchase', ${COIN}, -1)
        `,
      );
      // A lot cannot have more left than it ever held.
      await expectDbError(
        tx,
        () => tx`
          insert into credit_lots (account_id, source, micro_credits_total, micro_credits_remaining)
          values (${accountId}, 'purchase', ${COIN}, ${2 * COIN})
        `,
      );
      await expectDbError(
        tx,
        () => tx`
          insert into credit_holds (account_id, ref_type, ref_id, micro_credits)
          values (${accountId}, 'job', uuid_generate_v7(), 0)
        `,
      );
    });
  });
});
