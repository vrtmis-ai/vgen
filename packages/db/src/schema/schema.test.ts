import { getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { adminAuditLog, adminUsers } from "./admin";
import { creditGrants, creditLedger, orders, paymentAttempts, plans } from "./billing";
import { catalogVersions, config, models, offerings } from "./catalog";
import { idempotencyKeys, jobEvents, jobs, outbox, webhookDeliveries } from "./generation";
import { identities, users } from "./identity";
import { assets, communityPosts } from "./media";
import { frontendErrorReports } from "./observability";

describe("database schema contract", () => {
  it("exports every bounded-context table with its stable SQL name", () => {
    const tables = [
      users,
      identities,
      creditGrants,
      creditLedger,
      plans,
      orders,
      paymentAttempts,
      catalogVersions,
      models,
      offerings,
      config,
      jobs,
      jobEvents,
      outbox,
      idempotencyKeys,
      webhookDeliveries,
      assets,
      communityPosts,
      adminUsers,
      adminAuditLog,
      frontendErrorReports,
    ];

    expect(tables.map(getTableName)).toEqual([
      "users",
      "identities",
      "credit_grants",
      "credit_ledger",
      "plans",
      "orders",
      "payment_attempts",
      "catalog_versions",
      "models",
      "offerings",
      "config",
      "jobs",
      "job_events",
      "outbox",
      "idempotency_keys",
      "webhook_deliveries",
      "assets",
      "community_posts",
      "admin_users",
      "admin_audit_log",
      "frontend_error_reports",
    ]);
  });

  it("does not expose a mutable balance or provider URL column", () => {
    expect("balance" in users).toBe(false);
    expect("providerUrl" in assets).toBe(false);
    expect("url" in assets).toBe(false);
  });
});
