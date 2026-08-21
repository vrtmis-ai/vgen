import { grantsPermission, type BanScope, type PostgresAnalyticsRepository, type PostgresBansRepository, type UserSort } from "@vgen/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AdminGuard } from "./admin";

/**
 * What the business is doing, and what one customer has done.
 *
 * Three views written for an admin panel in migrations 0001 and 0002 have been
 * sitting unread in the schema ever since. This is the surface that reads them.
 *
 * **Two permissions, not one, and that is the point.** Aggregate numbers need
 * `analytics.read`. The customer list needs `users.read` as well, because it
 * carries every customer's email address beside what they spent. Splitting them
 * is what makes it possible later to hand somebody the money dashboard without
 * also handing them the mailing list — a distinction that cannot be recovered
 * once a single permission has been granted to everyone who needs a chart.
 *
 * Every mutation here writes an `audit_log` row before it answers, through the
 * same helper the invite and routing routes use. Adjusting a balance and
 * banning an account are the two most consequential things this panel can do to
 * a person, and `audit_log` is append-only at the database, so neither can be
 * tidied away afterwards by whoever did it.
 */

export interface AdminAnalyticsDependencies {
  analytics: PostgresAnalyticsRepository;
  bans: PostgresBansRepository;
}

const WindowSchema = z.enum(["today", "7d", "30d", "all"]).default("30d");

const UsersQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  sort: z.enum(["spent", "purchased", "balance", "created"]).default("spent"),
  // Capped rather than unbounded: this is the one query certain to be pointed
  // at a large table one day, and "give me every customer" should not be a
  // thing one mistyped querystring can ask for.
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

/**
 * A hand adjustment, in coins, signed.
 *
 * Bounded on both sides. There is no legitimate single correction of a million
 * coins, and the bound is the difference between a typo costing a conversation
 * and a typo costing the ledger. A note is required — an unexplained
 * adjustment in an append-only ledger is a permanent mystery.
 */
const AdjustCreditsSchema = z
  .object({
    coins: z
      .number()
      .int()
      .refine((value) => value !== 0, { message: "Nothing to adjust" })
      .refine((value) => Math.abs(value) <= 1_000_000, { message: "That is too large for a hand adjustment" }),
    note: z.string().trim().min(3).max(500),
  })
  .strict();

const CreateBanSchema = z
  .object({
    scope: z.enum(["platform", "explore", "comments", "generation"]),
    reason: z.string().trim().max(500).optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .strict();

export function registerAdminAnalyticsRoutes(app: FastifyInstance, dependencies: AdminAnalyticsDependencies, guard: AdminGuard): void {
  const { analytics, bans } = dependencies;
  const { require, audit } = guard;

  /**
   * `require` checks one permission; the customer list needs two.
   *
   * Written as a second check rather than a second `require` call so that a
   * failure answers 403 `forbidden` — the caller demonstrably has a staff
   * session, so 404 would be a lie about the surface's existence to somebody
   * already inside it.
   */
  const alsoNeeds = (reply: FastifyReply, session: { permissions: string[] }, permission: string): boolean => {
    if (grantsPermission(session.permissions, permission)) return true;
    void reply.code(403).send({ error: { code: "forbidden", message: "That is not permitted for your role." } });
    return false;
  };

  const windowOf = (request: FastifyRequest) => WindowSchema.parse((request.query as { window?: string } | undefined)?.window);

  // ------------------------------------------------------------- aggregates

  app.get("/api/v1/admin/analytics/overview", async (request, reply) => {
    const session = await require(request, reply, "analytics.read");
    if (!session) return reply;
    const window = windowOf(request);
    const [totals, standing, daily] = await Promise.all([analytics.overview(window), analytics.standing(), analytics.daily(window)]);
    return reply.send({ window, totals, standing, daily });
  });

  app.get("/api/v1/admin/analytics/models", async (request, reply) => {
    const session = await require(request, reply, "analytics.read");
    if (!session) return reply;
    const window = windowOf(request);
    return reply.send({ window, models: await analytics.models(window) });
  });

  app.get("/api/v1/admin/analytics/providers", async (request, reply) => {
    const session = await require(request, reply, "analytics.read");
    if (!session) return reply;
    const window = windowOf(request);
    return reply.send({ window, providers: await analytics.providers(window) });
  });

  // ----------------------------------------------------------------- people

  app.get("/api/v1/admin/users", async (request, reply) => {
    const session = await require(request, reply, "analytics.read");
    if (!session) return reply;
    if (!alsoNeeds(reply, session, "users.read")) return reply;

    const query = UsersQuerySchema.parse(request.query ?? {});
    const page = await analytics.users({
      sort: query.sort as UserSort,
      limit: query.limit,
      offset: query.offset,
      ...(query.search ? { search: query.search } : {}),
    });
    return reply.send({ ...page, limit: query.limit, offset: query.offset });
  });

  app.get("/api/v1/admin/users/:id", async (request, reply) => {
    const session = await require(request, reply, "analytics.read");
    if (!session) return reply;
    if (!alsoNeeds(reply, session, "users.read")) return reply;

    const { id } = request.params as { id: string };
    const user = await analytics.user(id);
    if (!user) return reply.code(404).send({ error: { code: "not_found", message: "No such user." } });
    return reply.send({ user, bans: await bans.listActive(id) });
  });

  // ---------------------------------------------------------------- actions

  app.post("/api/v1/admin/users/:id/credits", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "credits.grant");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    const body = AdjustCreditsSchema.parse(request.body);

    const before = await analytics.user(id);
    if (!before) return reply.code(404).send({ error: { code: "not_found", message: "No such user." } });

    try {
      await analytics.adjustCredits({ userId: id, coins: body.coins, note: body.note, actorUserId: session.userId });
    } catch (error) {
      // `adjust_credits` refuses to overdraw rather than clamping, which
      // arrives here as a CHECK violation. 409 rather than 500: the request was
      // well formed and the account simply does not have it.
      if (isOverdraw(error)) {
        return reply.code(409).send({ error: { code: "insufficient_credits", message: "That account does not have that many coins." } });
      }
      throw error;
    }

    const after = await analytics.user(id);
    await audit(request, session, {
      action: "credits.adjusted",
      targetType: "user",
      targetId: id,
      before: { coins: before.coinsBalance },
      after: { coins: after?.coinsBalance ?? null, delta: body.coins, note: body.note },
    });
    return reply.send({ user: after });
  });

  app.post("/api/v1/admin/users/:id/bans", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "users.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };
    const body = CreateBanSchema.parse(request.body);

    if (!(await analytics.user(id))) return reply.code(404).send({ error: { code: "not_found", message: "No such user." } });

    const ban = await bans.create({
      userId: id,
      scope: body.scope as BanScope,
      createdBy: session.userId,
      ...(body.reason ? { reason: body.reason } : {}),
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    });

    await audit(request, session, {
      action: "user.banned",
      targetType: "user",
      targetId: id,
      after: { scope: ban.scope, reason: ban.reason, expiresAt: ban.expiresAt },
    });
    return reply.code(201).send({ ban });
  });

  app.delete("/api/v1/admin/users/:id/bans/:banId", async (request, reply) => {
    const session = await require(request, reply, "users.write");
    if (!session) return reply;
    const { id, banId } = request.params as { id: string; banId: string };

    // Already lifted answers 404 rather than a cheerful 200: the caller
    // believed there was a ban to lift, and there was not.
    if (!(await bans.lift(banId))) return reply.code(404).send({ error: { code: "not_found", message: "No ban to lift." } });

    await audit(request, session, { action: "user.ban_lifted", targetType: "user", targetId: id, before: { banId } });
    return reply.send({ bans: await bans.listActive(id) });
  });

  app.delete("/api/v1/admin/users/:id/sessions", async (request, reply) => {
    const session = await require(request, reply, "users.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };

    const revoked = await analytics.revokeSessions(id);
    await audit(request, session, { action: "user.sessions_revoked", targetType: "user", targetId: id, after: { revoked } });
    return reply.send({ revoked });
  });
}

/** The SQLSTATE `adjust_credits` raises when the balance will not cover it. */
function isOverdraw(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "23514" &&
    String((error as { message?: string }).message ?? "").includes("adjust_credits")
  );
}
