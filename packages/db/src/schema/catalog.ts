import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
type JsonObject = Record<string, unknown>;

export const catalogVersions = pgTable("catalog_versions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  publishedAt: timestamptz("published_at"),
  note: text("note"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

export const models = pgTable(
  "models",
  {
    catalogVersion: integer("catalog_version")
      .notNull()
      .references(() => catalogVersions.id),
    key: text("key").notNull(),
    family: text("family").notNull(),
    kind: text("kind").notNull(),
    minTier: smallint("min_tier").notNull(),
    maxPrompt: integer("max_prompt"),
    noPrompt: boolean("no_prompt").notNull().default(false),
    spec: jsonb("spec").$type<JsonObject>().notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.catalogVersion, table.key] }),
    check("models_kind_check", sql`${table.kind} in ('image','video','audio')`),
  ],
);

export const offerings = pgTable(
  "offerings",
  {
    catalogVersion: integer("catalog_version").notNull(),
    modelKey: text("model_key").notNull(),
    provider: text("provider").notNull(),
    providerModel: text("provider_model").notNull(),
    rate: jsonb("rate").$type<JsonObject>().notNull(),
    priority: smallint("priority").notNull().default(100),
    active: boolean("active").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.catalogVersion, table.modelKey, table.provider] }),
    foreignKey({ columns: [table.catalogVersion, table.modelKey], foreignColumns: [models.catalogVersion, models.key] }),
    index("offerings_model_idx").on(table.catalogVersion, table.modelKey),
  ],
);

export const config = pgTable("config", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<JsonObject>().notNull(),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

export const configHistory = pgTable(
  "config_history",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    key: text("key").notNull(),
    oldValue: jsonb("old_value").$type<JsonObject>(),
    newValue: jsonb("new_value").$type<JsonObject>(),
    changedBy: uuid("changed_by"),
    changedAt: timestamptz("changed_at").notNull().defaultNow(),
  },
  (table) => [index("config_history_key_idx").on(table.key, table.changedAt)],
);
