import type { FrontendCrashReport } from "@vgen/contracts";
import type { Sql } from "postgres";

export interface StoredFrontendCrash {
  id: string;
  type: "frontend_crash";
  release: string;
  host: "web";
  route: string;
  code: string;
  requestId?: string | undefined;
  occurredAt: number;
  receivedAt: number;
}

interface FrontendCrashRow {
  id: string;
  type: "frontend_crash";
  release: string;
  host: "web";
  route: string;
  code: string;
  request_id: string | null;
  occurred_at: Date;
  received_at: Date;
}

function storedCrash(row: FrontendCrashRow): StoredFrontendCrash {
  return {
    id: row.id,
    type: row.type,
    release: row.release,
    host: row.host,
    route: row.route,
    code: row.code,
    ...(row.request_id ? { requestId: row.request_id } : {}),
    occurredAt: row.occurred_at.getTime(),
    receivedAt: row.received_at.getTime(),
  };
}

export class PostgresFrontendTelemetryRepository {
  constructor(private readonly sql: Sql) {}

  async record(report: FrontendCrashReport): Promise<string> {
    const [row] = await this.sql<{ id: string }[]>`
      insert into frontend_error_reports (
        type, release, host, route, code, request_id, occurred_at
      ) values (
        ${report.type}, ${report.release}, ${report.host}, ${report.route}, ${report.code},
        ${report.requestId ?? null}, ${new Date(report.occurredAt)}
      )
      returning id::text as id
    `;
    if (!row) throw new Error("Frontend error report was not recorded");
    return row.id;
  }

  async listRecent(limit = 50): Promise<StoredFrontendCrash[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    const rows = await this.sql<FrontendCrashRow[]>`
      select id::text as id, type, release, host, route, code, request_id, occurred_at, received_at
      from frontend_error_reports
      order by received_at desc, id desc
      limit ${safeLimit}
    `;
    return rows.map(storedCrash);
  }
}
