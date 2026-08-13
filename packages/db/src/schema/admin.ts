import { sql } from "drizzle-orm";
import { bigserial, check, index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./columns";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
type JsonObject = Record<string, unknown>;

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    role: text("role").notNull(),
    totpSecret: bytea("totp_secret").notNull(),
    disabledAt: timestamptz("disabled_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [check("admin_users_role_check", sql`${table.role} in ('viewer','operator','owner')`)],
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => adminUsers.id),
    at: timestamptz("at").notNull().defaultNow(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: jsonb("before").$type<JsonObject>(),
    after: jsonb("after").$type<JsonObject>(),
    reason: text("reason"),
    ip: inet("ip"),
    requestId: text("request_id"),
  },
  (table) => [index("admin_audit_target_idx").on(table.targetType, table.targetId, table.at)],
);
