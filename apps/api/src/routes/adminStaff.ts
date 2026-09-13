import { permissionsWithin, type PlanGrant, type StaffMember } from "@vgen/db";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AdminGuard } from "./admin";

/**
 * Appointing staff, and deciding what each of them can do.
 *
 * There was no route for any of this. The permission language existed and was
 * enforced on every admin route, but the only permissions available were the
 * four seeded roles' — and `admin` holds `["*"]` — so every member of staff was
 * either powerless or complete. Making somebody a moderator meant running
 * `scripts/create-admin.ts` on the server.
 *
 * Three rules hold this together, and all three are about the same thing:
 *
 *   1. **You cannot grant what you do not hold.** The whole of privilege
 *      escalation, checked with `permissionsWithin`.
 *   2. **You cannot touch somebody who holds what you do not.** Without this,
 *      an admin limited to the moderation queue could revoke the owner — the
 *      first rule stops them *granting* `*`, and says nothing about taking it
 *      away from the person who has it.
 *   3. **You cannot edit yourself.** Not a security rule so much as a
 *      lockout rule: the first two permit narrowing your own set, and the
 *      result is an admin console nobody can get back into.
 */

export interface AdminStaffDependencies {
  staff: {
    listStaff(): Promise<StaffMember[]>;
    staffMember(userId: string): Promise<StaffMember | null>;
    upsertStaff(input: { userId: string; roleCode: string; permissions: readonly string[] | null; grantedBy: string }): Promise<void>;
    appointStaff(input: {
      existingUserId: string | null;
      email: string;
      password: string | null;
      roleCode: string;
      permissions: readonly string[] | null;
      grantedBy: string;
    }): Promise<{ userId: string; totp: { secret: string; uri: string } | null }>;
    revokeStaff(userId: string, roleCode: string): Promise<boolean>;
    roles(): Promise<{ code: string; name: string; permissions: string[] }[]>;
    findUserByEmail(email: string): Promise<{ id: string; email: string | null } | null>;
  };
  planGrants: {
    activeFor(accountId: string): Promise<PlanGrant | null>;
    grant(input: {
      accountId: string;
      planCode: string;
      grantedBy: string;
      note?: string | undefined;
    }): Promise<{ outcome: string; grant?: PlanGrant }>;
    revoke(accountId: string, revokedBy: string): Promise<{ outcome: "revoked" | "not_active"; coinsWithdrawn: number }>;
  };
  /** The personal account a staff member's own generations are billed to. */
  accountForUser(userId: string): Promise<string | null>;
}

/**
 * A permission string, shaped like the ones the language already understands.
 *
 * Deliberately narrow: letters, digits, dots, and a trailing `.*`. Anything a
 * person can type into this field is compared against every admin route in the
 * system, and a permission language rich enough to be interesting is one where
 * a typo silently grants more than it reads as.
 */
const PermissionSchema = z
  .string()
  .trim()
  .max(120)
  .regex(/^(\*|[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(\.\*)?)$/, "not a permission");

const AppointSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    roleCode: z.string().trim().min(1).max(64),
    /**
     * Omit to inherit the role's own set, which is what every staff row
     * created before this route existed does. An array narrows it.
     */
    permissions: z.array(PermissionSchema).max(64).optional(),
    /** Only for an address with no account yet, which this creates. */
    password: z.string().min(10).max(512).optional(),
  })
  .strict();

const UpdateSchema = z
  .object({
    // Explicit null, not omission: "give them the role's set back" is a real
    // instruction and has to be distinguishable from "change nothing".
    permissions: z.array(PermissionSchema).max(64).nullable(),
  })
  .strict();

const GrantPlanSchema = z.object({ planCode: z.string().trim().min(1).max(64) }).strict();

export function registerAdminStaffRoutes(app: FastifyInstance, dependencies: AdminStaffDependencies, guard: AdminGuard): void {
  const { staff, planGrants } = dependencies;

  /**
   * Whether the actor is allowed to act on this person at all.
   *
   * Rules 2 and 3 above. The message is the same for both, because the honest
   * distinction — "you are not senior enough" versus "that is you" — is not
   * one the caller can do anything different about.
   */
  const mayAct = (actorPermissions: readonly string[], actorUserId: string, target: StaffMember): string | null => {
    if (target.userId === actorUserId) return "You cannot change your own access.";
    if (!permissionsWithin(actorPermissions, target.permissions)) {
      return "That person holds access you do not, so you cannot change theirs.";
    }
    return null;
  };

  app.get("/api/v1/admin/staff", async (request, reply) => {
    const session = await guard.require(request, reply, "staff.read");
    if (!session) return;
    return reply.send({
      staff: await staff.listStaff(),
      // What this actor may hand out, so the picker can offer exactly that and
      // no more. The client is not trusted with it — every write re-checks —
      // but a form that offers a permission the server will refuse is a form
      // that wastes people's time.
      grantable: session.permissions,
    });
  });

  app.get("/api/v1/admin/staff/roles", async (request, reply) => {
    const session = await guard.require(request, reply, "staff.read");
    if (!session) return;
    return reply.send({ roles: await staff.roles(), grantable: session.permissions });
  });

  /**
   * Appoint somebody, by email — creating their account when a password is
   * given for an address nobody uses yet.
   *
   * Staff are made by staff, not through signup, so they need no invite. That
   * is a second way to mint accounts, which is why it sits behind
   * `staff.write` and cannot make a customer: every account it creates holds a
   * role. A password for an address that already has an account is refused
   * rather than applied, or this would be a way to take over anyone's account.
   *
   * The response carries the new second-factor key when the person had none,
   * once. /admin refuses a password alone.
   */
  app.post("/api/v1/admin/staff", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "staff.write");
    if (!session) return;

    const body = AppointSchema.parse(request.body);
    const user = await staff.findUserByEmail(body.email);
    if (!user && !body.password) {
      return reply
        .code(404)
        .send({ error: { code: "no_such_user", message: "Nobody signs in with that address. Give a password to create their account." } });
    }
    if (user && body.password) {
      return reply
        .code(409)
        .send({ error: { code: "account_exists", message: "That address already has an account. Appoint it without a password." } });
    }
    if (user?.id === session.userId) {
      return reply.code(409).send({ error: { code: "self", message: "You cannot change your own access." } });
    }

    const roles = await staff.roles();
    const role = roles.find((candidate) => candidate.code === body.roleCode);
    if (!role) return reply.code(404).send({ error: { code: "no_such_role", message: "There is no such role." } });

    /* The set they will actually hold — theirs if given, the role's otherwise.
       Checked either way, because appointing somebody to a role you do not
       hold yourself is the same escalation as listing its permissions out. */
    const effective = body.permissions ?? role.permissions;
    if (!permissionsWithin(session.permissions, effective)) {
      return reply.code(403).send({ error: { code: "beyond_your_own", message: "You cannot grant access you do not hold." } });
    }

    const existing = user ? await staff.staffMember(user.id) : null;
    if (existing) {
      const refusal = mayAct(session.permissions, session.userId, existing);
      if (refusal) return reply.code(403).send({ error: { code: "outranked", message: refusal } });
    }

    let appointed: Awaited<ReturnType<typeof staff.appointStaff>>;
    try {
      appointed = await staff.appointStaff({
        existingUserId: user?.id ?? null,
        email: body.email,
        password: body.password ?? null,
        roleCode: body.roleCode,
        permissions: body.permissions ?? null,
        grantedBy: session.userId,
      });
    } catch (error) {
      // A suspended or deleted account still holds its address.
      if ((error as { code?: string }).code === "23505") {
        return reply.code(409).send({ error: { code: "account_exists", message: "That address already belongs to an account." } });
      }
      throw error;
    }
    await guard.audit(request, session, {
      action: "staff.appointed",
      targetType: "user",
      targetId: appointed.userId,
      after: { roleCode: body.roleCode, permissions: effective, accountCreated: !user, secondFactorIssued: appointed.totp !== null },
    });
    return reply.code(201).send({ staff: await staff.staffMember(appointed.userId), totp: appointed.totp });
  });

  /** Narrow or widen what one member of staff can do. */
  app.patch("/api/v1/admin/staff/:userId", { bodyLimit: 8 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "staff.write");
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const body = UpdateSchema.parse(request.body);
    const target = await staff.staffMember(userId);
    if (!target) return reply.code(404).send({ error: { code: "not_staff", message: "That person holds no role." } });

    const refusal = mayAct(session.permissions, session.userId, target);
    if (refusal) return reply.code(403).send({ error: { code: "outranked", message: refusal } });

    const roles = await staff.roles();
    const role = roles.find((candidate) => candidate.code === target.roleCode);
    const effective = body.permissions ?? role?.permissions ?? [];
    if (!permissionsWithin(session.permissions, effective)) {
      return reply.code(403).send({ error: { code: "beyond_your_own", message: "You cannot grant access you do not hold." } });
    }

    await staff.upsertStaff({
      userId,
      roleCode: target.roleCode,
      permissions: body.permissions,
      grantedBy: session.userId,
    });
    await guard.audit(request, session, {
      action: "staff.permissions.changed",
      targetType: "user",
      targetId: userId,
      before: { permissions: target.permissions },
      after: { permissions: effective },
    });
    return reply.send({ staff: await staff.staffMember(userId) });
  });

  app.delete("/api/v1/admin/staff/:userId", async (request, reply) => {
    const session = await guard.require(request, reply, "staff.write");
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const target = await staff.staffMember(userId);
    if (!target) return reply.code(404).send({ error: { code: "not_staff", message: "That person holds no role." } });

    const refusal = mayAct(session.permissions, session.userId, target);
    if (refusal) return reply.code(403).send({ error: { code: "outranked", message: refusal } });

    await staff.revokeStaff(userId, target.roleCode);
    await guard.audit(request, session, {
      action: "staff.revoked",
      targetType: "user",
      targetId: userId,
      before: { roleCode: target.roleCode, permissions: target.permissions },
    });
    return reply.send({ userId, revoked: true });
  });

  // ------------------------------------------------------- plans for staff

  /**
   * Turn a plan on for a member of staff.
   *
   * Its own permission, because it is a different act from appointing
   * somebody: it spends the company's own capacity rather than delegating
   * authority, and the people who should do one are not always the people who
   * should do the other.
   *
   * The monthly limit is not enforced here and does not need to be. A grant is
   * one term of the plan — a lot of credits that expires when the term does —
   * so the ceiling is the grant. See planGrantsRepository.
   */
  app.post("/api/v1/admin/staff/:userId/plan", { bodyLimit: 4 * 1024 }, async (request, reply) => {
    const session = await guard.require(request, reply, "plans.grant");
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const body = GrantPlanSchema.parse(request.body);
    const target = await staff.staffMember(userId);
    if (!target) return reply.code(404).send({ error: { code: "not_staff", message: "That person holds no role." } });

    const refusal = mayAct(session.permissions, session.userId, target);
    if (refusal) return reply.code(403).send({ error: { code: "outranked", message: refusal } });

    const accountId = await dependencies.accountForUser(userId);
    if (!accountId) return reply.code(404).send({ error: { code: "no_account", message: "That person has no account." } });

    const result = await planGrants.grant({ accountId, planCode: body.planCode, grantedBy: session.userId });
    if (result.outcome === "unknown_plan") {
      return reply.code(404).send({ error: { code: "unknown_plan", message: "There is no such plan." } });
    }
    if (result.outcome === "already_active") {
      // Not an error worth a 500 and not a success: pressing the button twice
      // must not hand out two terms' credits. The live grant comes back so the
      // screen can show what is already there.
      return reply.code(409).send({ error: { code: "already_active", message: "A plan is already active." }, plan: result.grant });
    }
    if (result.outcome !== "granted") {
      return reply.code(404).send({ error: { code: result.outcome, message: "That plan could not be granted." } });
    }

    await guard.audit(request, session, {
      action: "staff.plan.granted",
      targetType: "user",
      targetId: userId,
      after: { planCode: body.planCode, coins: result.grant?.coins, endsAt: result.grant?.endsAt },
    });
    return reply.code(201).send({ plan: result.grant });
  });

  app.delete("/api/v1/admin/staff/:userId/plan", async (request, reply) => {
    const session = await guard.require(request, reply, "plans.grant");
    if (!session) return;

    const { userId } = request.params as { userId: string };
    const target = await staff.staffMember(userId);
    if (!target) return reply.code(404).send({ error: { code: "not_staff", message: "That person holds no role." } });

    const refusal = mayAct(session.permissions, session.userId, target);
    if (refusal) return reply.code(403).send({ error: { code: "outranked", message: refusal } });

    const accountId = await dependencies.accountForUser(userId);
    if (!accountId) return reply.code(404).send({ error: { code: "no_account", message: "That person has no account." } });

    const result = await planGrants.revoke(accountId, session.userId);
    if (result.outcome === "not_active") {
      return reply.code(404).send({ error: { code: "not_active", message: "No plan is active for that person." } });
    }

    await guard.audit(request, session, {
      action: "staff.plan.revoked",
      targetType: "user",
      targetId: userId,
      after: { coinsWithdrawn: result.coinsWithdrawn },
    });
    return reply.send({ userId, revoked: true, coinsWithdrawn: result.coinsWithdrawn });
  });

  /** What is live on a staff account right now, for the row that shows it. */
  app.get("/api/v1/admin/staff/:userId/plan", async (request, reply) => {
    const session = await guard.require(request, reply, "staff.read");
    if (!session) return;
    const { userId } = request.params as { userId: string };
    const accountId = await dependencies.accountForUser(userId);
    if (!accountId) return reply.code(404).send({ error: { code: "no_account", message: "That person has no account." } });
    return reply.send({ plan: await planGrants.activeFor(accountId) });
  });
}
