import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, numeric, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./columns";
import { jobs } from "./generation";
import { users } from "./identity";

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
type JsonObject = Record<string, unknown>;

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    jobId: uuid("job_id").references(() => jobs.id),
    kind: text("kind").notNull(),
    role: text("role").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    bytes: bigint("bytes", { mode: "bigint" }).notNull(),
    mime: text("mime").notNull(),
    sha256: bytea("sha256").notNull(),
    phash: bytea("phash"),
    width: integer("width"),
    height: integer("height"),
    durationMs: integer("duration_ms"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    deletedAt: timestamptz("deleted_at"),
  },
  (table) => [
    check("assets_kind_check", sql`${table.kind} in ('image','video','audio')`),
    check("assets_role_check", sql`${table.role} in ('input','output','thumbnail','poster')`),
    check("assets_bytes_check", sql`${table.bytes} >= 0`),
    check(
      "assets_dimensions_check",
      sql`(${table.width} is null or ${table.width} > 0) and (${table.height} is null or ${table.height} > 0) and (${table.durationMs} is null or ${table.durationMs} >= 0)`,
    ),
    index("assets_user_idx")
      .on(table.userId, table.createdAt)
      .where(sql`${table.deletedAt} is null`),
    index("assets_job_idx").on(table.jobId),
    index("assets_phash_idx")
      .on(table.phash)
      .where(sql`${table.phash} is not null`),
  ],
);

export const communityPosts = pgTable(
  "community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    jobId: uuid("job_id").references(() => jobs.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    prompt: text("prompt"),
    modelKey: text("model_key"),
    params: jsonb("params").$type<JsonObject>(),
    status: text("status").notNull().default("pending"),
    consentAt: timestamptz("consent_at").notNull(),
    matchScore: numeric("match_score", { precision: 5, scale: 2 }),
    matchedJobs: uuid("matched_jobs").array(),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: timestamptz("reviewed_at"),
    reviewNote: text("review_note"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("community_posts_kind_check", sql`${table.kind} in ('image','video','montage')`),
    check("community_posts_status_check", sql`${table.status} in ('pending','approved','rejected','removed')`),
    check("community_posts_reproducible_check", sql`${table.kind} = 'montage' or ${table.jobId} is not null`),
    unique("community_posts_asset_unique").on(table.assetId),
    index("community_feed_idx")
      .on(table.status, table.createdAt)
      .where(sql`${table.status} = 'approved'`),
    index("community_queue_idx")
      .on(table.createdAt)
      .where(sql`${table.status} = 'pending'`),
  ],
);
