import { sql } from "drizzle-orm";
import {
  bigint,
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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const int8 = (name: string) => bigint(name, { mode: "bigint" });
type JsonObject = Record<string, unknown>;

export const creditGrants = pgTable(
  "credit_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    amount: int8("amount").notNull(),
    consumed: int8("consumed").notNull().default(0n),
    grantedAt: timestamptz("granted_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at"),
    sourceType: text("source_type"),
    sourceId: uuid("source_id"),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("credit_grants_kind_check", sql`${table.kind} in ('plan','signup_gift','reward','referral','admin','compensation')`),
    check("credit_grants_amount_check", sql`${table.amount} > 0`),
    check("credit_grants_consumed_check", sql`${table.consumed} >= 0 and ${table.consumed} <= ${table.amount}`),
    index("credit_grants_spendable_idx")
      .on(table.userId, table.expiresAt, table.grantedAt)
      .where(sql`${table.consumed} < ${table.amount}`),
  ],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    grantId: uuid("grant_id").references(() => creditGrants.id),
    delta: int8("delta").notNull(),
    reason: text("reason").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    actorType: text("actor_type").notNull().default("system"),
    actorId: uuid("actor_id"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("credit_ledger_delta_check", sql`${table.delta} <> 0`),
    check(
      "credit_ledger_reason_check",
      sql`${table.reason} in ('grant_plan','grant_signup_gift','grant_reward','grant_referral','grant_admin','job_hold','job_settle_extra','job_settle_refund','job_refund_failed','job_refund_cancelled','expire','admin_debit')`,
    ),
    check("credit_ledger_actor_type_check", sql`${table.actorType} in ('system','user','admin')`),
    unique("credit_ledger_user_idempotency_unique").on(table.userId, table.idempotencyKey),
    index("credit_ledger_user_idx").on(table.userId, table.id),
    index("credit_ledger_ref_idx").on(table.refType, table.refId),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: text("id").notNull(),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    tier: smallint("tier").notNull(),
    creditsPerCycle: int8("credits_per_cycle").notNull(),
    cycleDays: integer("cycle_days").notNull(),
    grantTtlDays: integer("grant_ttl_days").notNull(),
    priceUsdMicros: int8("price_usd_micros").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.version] }),
    check("plans_credits_check", sql`${table.creditsPerCycle} > 0`),
    check("plans_price_check", sql`${table.priceUsdMicros} > 0`),
    check("plans_cycle_days_check", sql`${table.cycleDays} > 0 and ${table.grantTtlDays} > 0`),
    uniqueIndex("plans_active_idx")
      .on(table.id)
      .where(sql`${table.active}`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    planId: text("plan_id"),
    planVersion: integer("plan_version"),
    cycle: text("cycle"),
    amountIrr: int8("amount_irr").notNull(),
    usdRateIrr: int8("usd_rate_irr").notNull(),
    status: text("status").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    paidAt: timestamptz("paid_at"),
  },
  (table) => [
    check("orders_kind_check", sql`${table.kind} = 'plan'`),
    check("orders_cycle_check", sql`${table.cycle} is null or ${table.cycle} in ('monthly','annual')`),
    check("orders_amount_check", sql`${table.amountIrr} > 0 and ${table.usdRateIrr} > 0`),
    check("orders_status_check", sql`${table.status} in ('created','pending','paid','failed','expired','refunded')`),
    foreignKey({ columns: [table.planId, table.planVersion], foreignColumns: [plans.id, plans.version] }),
    index("orders_user_idx").on(table.userId, table.createdAt),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    planId: text("plan_id").notNull(),
    planVersion: integer("plan_version").notNull(),
    cycle: text("cycle").notNull(),
    cyclesTotal: integer("cycles_total").notNull(),
    cyclesGranted: integer("cycles_granted").notNull().default(0),
    nextGrantAt: timestamptz("next_grant_at"),
    status: text("status").notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("subscriptions_cycle_check", sql`${table.cycle} in ('monthly','annual')`),
    check(
      "subscriptions_cycles_check",
      sql`${table.cyclesTotal} > 0 and ${table.cyclesGranted} >= 0 and ${table.cyclesGranted} <= ${table.cyclesTotal}`,
    ),
    check("subscriptions_status_check", sql`${table.status} in ('active','completed','cancelled')`),
    foreignKey({ columns: [table.planId, table.planVersion], foreignColumns: [plans.id, plans.version] }),
    unique("subscriptions_order_unique").on(table.orderId),
    index("subscriptions_due_idx")
      .on(table.nextGrantAt)
      .where(sql`${table.status} = 'active' and ${table.nextGrantAt} is not null`),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    gateway: text("gateway").notNull(),
    authority: text("authority"),
    amountIrr: int8("amount_irr").notNull(),
    status: text("status").notNull(),
    gatewayRefId: text("gateway_ref_id"),
    rawRequest: jsonb("raw_request").$type<JsonObject>(),
    rawResponse: jsonb("raw_response").$type<JsonObject>(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    verifiedAt: timestamptz("verified_at"),
  },
  (table) => [
    check("payment_attempts_amount_check", sql`${table.amountIrr} > 0`),
    check("payment_attempts_status_check", sql`${table.status} in ('created','redirected','verified','duplicate','failed')`),
    unique("payment_attempts_gateway_authority_unique").on(table.gateway, table.authority),
  ],
);

export const rewardRules = pgTable(
  "reward_rules",
  {
    key: text("key").primaryKey(),
    credits: int8("credits").notNull(),
    ttlDays: integer("ttl_days"),
    repeatable: boolean("repeatable").notNull().default(false),
    maxClaims: integer("max_claims"),
    active: boolean("active").notNull().default(true),
    config: jsonb("config").$type<JsonObject>().notNull().default({}),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("reward_rules_credits_check", sql`${table.credits} > 0`),
    check("reward_rules_repeatable_check", sql`not ${table.repeatable} or ${table.maxClaims} is not null`),
  ],
);

export const rewardClaims = pgTable(
  "reward_claims",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    ruleKey: text("rule_key")
      .notNull()
      .references(() => rewardRules.key),
    grantId: uuid("grant_id").references(() => creditGrants.id),
    seq: integer("seq").notNull().default(1),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [unique("reward_claims_user_rule_seq_unique").on(table.userId, table.ruleKey, table.seq)],
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => users.id),
    referredUserId: uuid("referred_user_id")
      .notNull()
      .references(() => users.id)
      .unique(),
    code: text("code").notNull(),
    qualifiedAt: timestamptz("qualified_at"),
    grantId: uuid("grant_id").references(() => creditGrants.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("referrals_not_self_check", sql`${table.referrerUserId} <> ${table.referredUserId}`),
    index("referrals_referrer_idx").on(table.referrerUserId),
  ],
);
