import { grantsPermission, type AdminSession, type PostgresAccessRepository, type PostgresAdminRepository } from "@vgen/db";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { clearAdminCookie, readAdminToken, setAdminCookie, type CookieOptions } from "../auth/cookies";
import { registerAdminAnalyticsRoutes, type AdminAnalyticsDependencies } from "./adminAnalytics";
import { registerAdminCatalogRoutes, type AdminCatalogDependencies } from "./adminCatalog";

export interface AdminDependencies {
  admin: PostgresAdminRepository;
  access: PostgresAccessRepository;
  /**
   * Providers and routing. Optional so the customer-surface tests can mount the
   * staff routes without a catalogue — there is no half-configured mode where
   * the section exists but cannot answer.
   */
  catalog?: AdminCatalogDependencies | undefined;
  /**
   * The money and the customer list. Optional for the same reason `catalog` is
   * — the customer-surface tests mount the staff routes without a database
   * behind them, and a section that existed but could not answer would be worse
   * than one that is absent.
   */
  analytics?: AdminAnalyticsDependencies | undefined;
  /** Reused so staff prove who they are the same way customers do, before the second factor. */
  verifyPassword(email: string, password: string): Promise<{ id: string; emailNormalized: string }>;
}

export interface AdminRouteOptions {
  cookie: CookieOptions;
}

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * The permission gate and the audit writer, handed to every file that adds
 * staff routes.
 *
 * Passed rather than re-derived because both carry decisions that must not be
 * made twice: `require` answers 404 for a non-admin so the surface's existence
 * is not confirmed, and refuses anyone whose session has not proved a second
 * factor. A route file that built its own gate would eventually build a
 * slightly different one.
 */
export interface AdminGuard {
  require(request: FastifyRequest, reply: FastifyReply, permission: string): Promise<AdminSession | null>;
  audit(request: FastifyRequest, session: AdminSession, entry: AuditInput): Promise<void>;
}

const SignInSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(512) }).strict();
const MfaSchema = z.object({ code: z.string().trim().min(6).max(32) }).strict();

const CreateInviteSchema = z
  .object({
    code: z.string().trim().min(3).max(64).optional(),
    label: z.string().trim().max(200).optional(),
    kind: z.enum(["campaign", "user"]).optional(),
    maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
    grantCoins: z.number().int().nonnegative().max(100_000).optional(),
    grantExpiresDays: z.number().int().positive().max(3650).optional(),
    expiresAt: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
    /** Generates this many random codes instead of one. Custom codes cannot be batched. */
    count: z.number().int().min(1).max(500).optional(),
  })
  .strict()
  .refine((value) => !(value.count && value.count > 1 && value.code), {
    message: "A batch cannot share one custom code",
  });

const CreatePromoSchema = z
  .object({
    code: z.string().trim().min(3).max(64).optional(),
    label: z.string().trim().max(200).optional(),
    kind: z.enum(["credits", "percent_off", "amount_off", "free_term"]),
    coins: z.number().int().positive().max(1_000_000).optional(),
    percentOff: z.number().min(0).max(100).optional(),
    amountOff: z.number().positive().max(1_000_000_000).optional(),
    planId: z.string().uuid().optional(),
    maxRedemptions: z.number().int().positive().max(1_000_000).optional(),
    maxPerAccount: z.number().int().positive().max(100).optional(),
    firstPurchaseOnly: z.boolean().optional(),
    expiresAt: z.coerce.date().optional(),
  })
  .strict();

const EarlyAccessSchema = z.object({ enabled: z.boolean() }).strict();

/**
 * Staff routes.
 *
 * Two things hold here and are worth stating plainly, because both are easy to
 * lose in a refactor:
 *
 *   1. Authorisation is per-permission, never "is this an admin". Roles carry a
 *      list, routes name what they need, and a narrower role can be created
 *      later with no code change.
 *   2. Every mutation writes an audit row before it answers. `audit_log` is
 *      append-only at the database, so that record cannot be tidied afterwards
 *      by the person who made it.
 */
export function registerAdminRoutes(app: FastifyInstance, dependencies: AdminDependencies, options: AdminRouteOptions): void {
  const { admin, access } = dependencies;
  const { cookie } = options;

  /**
   * Resolves the staff session and checks one permission.
   *
   * Answers 404 rather than 403 for someone with no staff role at all, so the
   * existence of the admin surface is not confirmed to a customer poking at it.
   */
  const require = async (request: FastifyRequest, reply: FastifyReply, permission: string): Promise<AdminSession | null> => {
    const token = readAdminToken(request);
    const session = token ? await admin.resolveSession(token) : null;
    if (!session) {
      void reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
      return null;
    }
    if (!session.mfaVerified) {
      void reply.code(403).send({ error: { code: "mfa_required", message: "Confirm your second factor." } });
      return null;
    }
    if (!grantsPermission(session.permissions, permission)) {
      void reply.code(403).send({ error: { code: "forbidden", message: "That is not permitted for your role." } });
      return null;
    }
    return session;
  };

  const audit = (request: FastifyRequest, session: AdminSession, entry: AuditInput) =>
    admin.recordAudit({
      actorUserId: session.userId,
      actorRole: session.roles[0],
      ip: request.ip,
      userAgent: request.headers["user-agent"],
      ...entry,
    });

  if (dependencies.catalog) registerAdminCatalogRoutes(app, dependencies.catalog, { require, audit });
  if (dependencies.analytics) registerAdminAnalyticsRoutes(app, dependencies.analytics, { require, audit });

  // ------------------------------------------------------------ signing in

  app.post("/api/v1/admin/session", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = SignInSchema.parse(request.body);
    let userId: string;
    try {
      ({ id: userId } = await dependencies.verifyPassword(body.email, body.password));
    } catch {
      // Same answer as a non-staff account: this endpoint must not reveal which
      // addresses are staff.
      return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    }

    const principal = await admin.resolvePrincipal(userId);
    if (!principal) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
    if (!principal.hasMfa) {
      // No second factor, no session at all. Letting them in "just this once"
      // is how v_admins_without_mfa stops being empty.
      return reply.code(403).send({ error: { code: "mfa_not_enrolled", message: "Enrol a second factor first." } });
    }

    const { token, expiresAt } = await admin.createSession(userId, request.ip, request.headers["user-agent"]);
    setAdminCookie(reply, token, expiresAt, cookie);
    // 202, not 200: the session exists but authorises nothing yet.
    return reply.code(202).send({ status: "mfa_required" });
  });

  app.post("/api/v1/admin/session/mfa", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const body = MfaSchema.parse(request.body);
    const token = readAdminToken(request);
    const session = token ? await admin.resolveSession(token) : null;
    if (!session) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });

    if (!(await admin.verifySecondFactor(session.userId, body.code))) {
      await admin.recordAudit({
        actorUserId: session.userId,
        action: "admin.mfa.failed",
        ip: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return reply.code(403).send({ error: { code: "mfa_invalid", message: "That code is not correct." } });
    }

    await admin.markSessionMfaVerified(token!);
    await admin.recordAudit({ actorUserId: session.userId, action: "admin.signed_in", ip: request.ip });
    return reply.code(200).send({ status: "authed", roles: session.roles, permissions: session.permissions });
  });

  /**
   * Who am I, and what may I do?
   *
   * A panel that cannot ask this has to find out by attempting something and
   * reading the failure, which is a bad way to decide what to render: `require`
   * answers 404 for a non-admin *and* for an expired session, so a probe cannot
   * tell "you were never staff" from "your session lapsed" — and the panel
   * would draw sections the person cannot use, then fail when they clicked.
   *
   * Deliberately NOT behind `require`. It is the one route that has to answer
   * before a second factor is confirmed, because "signed in, needs MFA" is a
   * state the sign-in screen must be able to resume into after a reload. It
   * discloses nothing a holder of the cookie does not already possess.
   */
  app.get("/api/v1/admin/session", async (request, reply) => {
    const token = readAdminToken(request);
    const session = token ? await admin.resolveSession(token) : null;
    // The same 404 the rest of the surface gives, so an expired staff cookie
    // and a customer poking at the URL are indistinguishable from outside.
    if (!session) return reply.code(404).send({ error: { code: "not_found", message: "Not found." } });

    return reply.send({
      status: session.mfaVerified ? "authed" : "mfa_required",
      email: session.email,
      roles: session.roles,
      // Empty until the second factor lands: a panel must not render a section
      // from a session that cannot yet call it.
      permissions: session.mfaVerified ? session.permissions : [],
    });
  });

  app.delete("/api/v1/admin/session", async (request, reply) => {
    const token = readAdminToken(request);
    if (token) await admin.revokeSession(token);
    clearAdminCookie(reply, cookie);
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- invites

  app.get("/api/v1/admin/invites", async (request, reply) => {
    const session = await require(request, reply, "invites.read");
    if (!session) return reply;
    return reply.send({ invites: await access.listInvites(200) });
  });

  app.get("/api/v1/admin/invites/:id", async (request, reply) => {
    const session = await require(request, reply, "invites.read");
    if (!session) return reply;
    const { id } = request.params as { id: string };

    const invite = await access.getInvite(id);
    if (!invite) return reply.code(404).send({ error: { code: "not_found", message: "No such invite code." } });
    // The per-person breakdown behind "how many credits did they use".
    return reply.send({ invite, redeemers: await access.listInviteRedeemers(id) });
  });

  app.post("/api/v1/admin/invites", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "invites.write");
    if (!session) return reply;
    const body = CreateInviteSchema.parse(request.body);

    const { count, ...input } = body;
    const created =
      count && count > 1
        ? await access.createInviteBatch(count, { ...input, createdBy: session.userId })
        : [await access.createInvite({ ...input, createdBy: session.userId })];

    await audit(request, session, {
      action: "invite.created",
      targetType: "invite_code",
      ...(created.length === 1 ? { targetId: created[0]!.id } : {}),
      after: created.map((invite) => ({ id: invite.id, code: invite.code, grantCoins: invite.grantCoins })),
    });
    return reply.code(201).send({ invites: created });
  });

  app.delete("/api/v1/admin/invites/:id", async (request, reply) => {
    const session = await require(request, reply, "invites.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };

    const before = await access.getInvite(id);
    if (!before) return reply.code(404).send({ error: { code: "not_found", message: "No such invite code." } });

    // Deleting a code somebody used would erase the campaign's own result and
    // the trail for tracing an abusive inviter, so that case revokes instead.
    const outcome = await access.deleteInvite(id);
    if (outcome === "deleted") {
      await audit(request, session, { action: "invite.deleted", targetType: "invite_code", targetId: id, before });
      return reply.code(200).send({ outcome: "deleted" });
    }

    const after = await access.revokeInvite(id, session.userId);
    await audit(request, session, { action: "invite.revoked", targetType: "invite_code", targetId: id, before, after });
    return reply.code(200).send({ outcome: "revoked", invite: after });
  });

  // --------------------------------------------------------------- promos

  app.get("/api/v1/admin/promos", async (request, reply) => {
    const session = await require(request, reply, "promos.read");
    if (!session) return reply;
    return reply.send({ promos: await access.listPromos(200) });
  });

  app.post("/api/v1/admin/promos", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const session = await require(request, reply, "promos.write");
    if (!session) return reply;
    const body = CreatePromoSchema.parse(request.body);

    const promo = await access.createPromo({ ...body, createdBy: session.userId });
    await audit(request, session, { action: "promo.created", targetType: "promo_code", targetId: promo.id, after: promo });
    return reply.code(201).send({ promo });
  });

  app.delete("/api/v1/admin/promos/:id", async (request, reply) => {
    const session = await require(request, reply, "promos.write");
    if (!session) return reply;
    const { id } = request.params as { id: string };

    const before = await access.getPromo(id);
    if (!before) return reply.code(404).send({ error: { code: "not_found", message: "No such discount code." } });

    const outcome = await access.deletePromo(id);
    if (outcome === "deleted") {
      await audit(request, session, { action: "promo.deleted", targetType: "promo_code", targetId: id, before });
      return reply.code(200).send({ outcome: "deleted" });
    }

    const after = await access.revokePromo(id, session.userId);
    await audit(request, session, { action: "promo.revoked", targetType: "promo_code", targetId: id, before, after });
    return reply.code(200).send({ outcome: "revoked", promo: after });
  });

  // ---------------------------------------------------------- early access

  app.get("/api/v1/admin/early-access", async (request, reply) => {
    const session = await require(request, reply, "invites.read");
    if (!session) return reply;
    return reply.send({ enabled: await access.isEarlyAccess() });
  });

  app.patch("/api/v1/admin/early-access", { bodyLimit: 1024 }, async (request, reply) => {
    const session = await require(request, reply, "flags.write");
    if (!session) return reply;
    const body = EarlyAccessSchema.parse(request.body);

    // Opening the product to the public is one row, and one of the more
    // consequential things anyone can do here, so it is audited like the rest.
    const before = await access.isEarlyAccess();
    const enabled = await access.setEarlyAccess(body.enabled, session.userId);
    await audit(request, session, {
      action: "early_access.changed",
      targetType: "feature_flag",
      before: { enabled: before },
      after: { enabled },
    });
    return reply.send({ enabled });
  });
}
