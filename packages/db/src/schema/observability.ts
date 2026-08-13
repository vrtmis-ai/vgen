import { sql } from "drizzle-orm";
import { bigserial, check, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const frontendErrorReports = pgTable(
  "frontend_error_reports",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    type: text("type").notNull(),
    release: text("release").notNull(),
    host: text("host").notNull(),
    route: text("route").notNull(),
    code: text("code").notNull(),
    requestId: text("request_id"),
    occurredAt: timestamptz("occurred_at").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  (table) => [
    check("frontend_error_reports_type_check", sql`${table.type} = 'frontend_crash'`),
    check("frontend_error_reports_host_check", sql`${table.host} = 'web'`),
    index("frontend_error_reports_received_idx").on(table.receivedAt, table.id),
    index("frontend_error_reports_code_route_idx").on(table.code, table.route, table.receivedAt),
    index("frontend_error_reports_request_idx").on(table.requestId),
  ],
);
