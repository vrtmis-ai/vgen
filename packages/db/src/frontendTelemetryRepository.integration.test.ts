import type { Sql } from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresFrontendTelemetryRepository } from "./frontendTelemetryRepository";
import { connect, inRollback } from "./integrationHarness";

let sql: Sql;

beforeAll(() => {
  sql = connect();
});
afterAll(async () => {
  await sql.end();
});

describe("Postgres frontend telemetry repository", () => {
  it("records and reads back only sanitized operational context", async () => {
    await inRollback(sql, async (tx) => {
      const repository = new PostgresFrontendTelemetryRepository(tx);
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
      const recent = await repository.listRecent(10);
      expect(recent[0]).toMatchObject({
        id: reportId,
        release: "2026.08.12",
        route: "/generate/seedance",
        code: "provider_unavailable",
        requestId: "req-7",
      });
    });
  });

  it("refuses a route carrying a query string", async () => {
    await inRollback(sql, async (tx) => {
      // The CHECK constraint is the real guarantee that a crash beacon cannot
      // carry user content: a prompt would arrive as a query string or a
      // fragment, and neither can be stored.
      await expect(
        tx`
          insert into frontend_error_reports (type, release, host, route, code, occurred_at)
          values ('frontend_crash', 'test', 'web', '/generate?prompt=secret', 'boom', now())
        `,
      ).rejects.toThrow();
    });
  });
});
