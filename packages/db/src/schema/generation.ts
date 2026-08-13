import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { catalogVersions } from "./catalog";
import { bytea } from "./columns";
import { users } from "./identity";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const int8 = (name: string) => bigint(name, { mode: "bigint" });
type JsonObject = Record<string, unknown>;

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    catalogVersion: integer("catalog_version")
      .notNull()
      .references(() => catalogVersions.id),
    modelKey: text("model_key").notNull(),
    paramsHash: bytea("params_hash").notNull(),
    providerCostUsdMicros: int8("provider_cost_usd_micros").notNull(),
    sellPriceCredits: int8("sell_price_credits").notNull(),
    exchangeRateIrrPerUsd: int8("exchange_rate_irr_per_usd").notNull(),
    marginUsdMicros: int8("margin_usd_micros").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("quotes_cost_check", sql`${table.providerCostUsdMicros} >= 0`),
    check("quotes_price_check", sql`${table.sellPriceCredits} >= 0`),
    check("quotes_exchange_rate_check", sql`${table.exchangeRateIrrPerUsd} > 0`),
    index("quotes_user_expiry_idx").on(table.userId, table.expiresAt),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id)
      .unique(),
    status: text("status").notNull(),
    catalogVersion: integer("catalog_version")
      .notNull()
      .references(() => catalogVersions.id),
    modelKey: text("model_key").notNull(),
    params: jsonb("params").$type<JsonObject>().notNull(),
    paramsHash: bytea("params_hash").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    quotedCredits: int8("quoted_credits").notNull(),
    heldCredits: int8("held_credits").notNull(),
    settledCredits: int8("settled_credits"),
    provider: text("provider"),
    providerTaskId: text("provider_task_id"),
    providerCostUsdMicros: int8("provider_cost_usd_micros"),
    attempts: smallint("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    submittedAt: timestamptz("submitted_at"),
    completedAt: timestamptz("completed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("jobs_status_check", sql`${table.status} in ('queued','submitted','running','succeeded','failed','cancelled','expired')`),
    check("jobs_quoted_credits_check", sql`${table.quotedCredits} >= 0`),
    check("jobs_held_credits_check", sql`${table.heldCredits} >= 0`),
    check("jobs_settled_credits_check", sql`${table.settledCredits} is null or ${table.settledCredits} >= 0`),
    unique("jobs_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    uniqueIndex("jobs_provider_task_idx")
      .on(table.provider, table.providerTaskId)
      .where(sql`${table.providerTaskId} is not null`),
    index("jobs_user_idx").on(table.userId, table.createdAt),
    index("jobs_active_idx")
      .on(table.status, table.updatedAt)
      .where(sql`${table.status} in ('queued','submitted','running')`),
  ],
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id),
    at: timestamptz("at").notNull().defaultNow(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    source: text("source").notNull(),
    payload: jsonb("payload").$type<JsonObject>(),
  },
  (table) => [
    check("job_events_source_check", sql`${table.source} in ('api','worker','webhook','poller','admin')`),
    index("job_events_job_idx").on(table.jobId, table.id),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    aggregate: text("aggregate").notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    availableAt: timestamptz("available_at").notNull().defaultNow(),
    publishedAt: timestamptz("published_at"),
    deadLetteredAt: timestamptz("dead_lettered_at"),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
  },
  (table) => [
    unique("outbox_aggregate_event_unique").on(table.aggregate, table.aggregateId, table.eventType),
    index("outbox_pending_idx")
      .on(table.availableAt, table.id)
      .where(sql`${table.publishedAt} is null and ${table.deadLetteredAt} is null`),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    endpoint: text("endpoint").notNull(),
    requestHash: bytea("request_hash").notNull(),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body").$type<JsonObject>(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
  },
  (table) => [
    check("idempotency_keys_status_check", sql`${table.status} in ('in_progress','completed')`),
    index("idempotency_keys_expiry_idx").on(table.expiresAt),
  ],
);

export const providerHealth = pgTable(
  "provider_health",
  {
    provider: text("provider").primaryKey(),
    balanceUsdMicros: int8("balance_usd_micros"),
    balanceAt: timestamptz("balance_at"),
    errorRate5m: numeric("error_rate_5m", { precision: 5, scale: 4 }),
    p95LatencyMs: integer("p95_latency_ms"),
    state: text("state").notNull().default("closed"),
    stateChangedAt: timestamptz("state_changed_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check("provider_health_state_check", sql`${table.state} in ('closed','half_open','open')`),
    check("provider_health_balance_check", sql`${table.balanceUsdMicros} is null or ${table.balanceUsdMicros} >= 0`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    timestampS: int8("timestamp_s").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
    accepted: boolean("accepted").notNull(),
    reason: text("reason"),
  },
  (table) => [unique("webhook_deliveries_dedupe_unique").on(table.provider, table.externalId, table.timestampS)],
);
