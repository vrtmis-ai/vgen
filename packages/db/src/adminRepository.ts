import {
  generateSessionToken,
  generateTotpSecret,
  hashPassword,
  hashToken,
  openSecret,
  sealSecret,
  totpEnrolmentUri,
  verifyTotp,
} from "@vgen/core";
import { randomBytes } from "node:crypto";
import type { Sql } from "postgres";
import { atomically } from "./transaction";

/** Staff sessions are short. A month is right for a phone, not for an account that can revoke codes. */
const ADMIN_SESSION_TTL_HOURS = 12;
/**
 * And they go stale sooner than they expire.
 *
 * Twelve hours is the ceiling on a session; ninety minutes is how long one may
 * sit untouched. The two answer different risks — the first bounds a stolen
 * token, the second bounds a laptop left unlocked at a desk — and only the
 * first existed.
 */
const ADMIN_SESSION_IDLE_MINUTES = 90;
const RECOVERY_CODE_COUNT = 10;

export class AdminAuthError extends Error {
  constructor(
    readonly code: "not_admin" | "mfa_required" | "mfa_invalid" | "mfa_not_enrolled" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "AdminAuthError";
  }
}

export interface AdminPrincipal {
  userId: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  hasMfa: boolean;
}

export interface AdminSession extends AdminPrincipal {
  sessionId: string;
  mfaVerified: boolean;
}

/**
 * Matches a required permission against what a role grants.
 *
 * Supports an exact string, a `section.*` prefix, and the `*` wildcard the
 * seeded `admin` role uses. Deliberately not a regex engine: a permission
 * language rich enough to be interesting is one where a typo silently grants
 * more than it reads as.
 */
export function grantsPermission(held: readonly string[], required: string): boolean {
  for (const permission of held) {
    if (permission === "*" || permission === required) return true;
    if (permission.endsWith(".*") && required.startsWith(permission.slice(0, -1))) return true;
  }
  return false;
}

/**
 * Whether one person may hand another exactly this set.
 *
 * The whole of privilege escalation, in one line: you cannot give away what
 * you do not have. An admin holding `community.*` can appoint a moderator with
 * `community.read`, or with `community.*`, and cannot appoint anyone with
 * `users.write` or with `*`.
 *
 * Note what it does *not* try to be clever about. `community.read` does not
 * entitle you to grant `community.*`, because the wildcard is a larger claim
 * than the thing you hold — `grantsPermission` answers that correctly by
 * comparing the strings rather than by reasoning about hierarchies, and this
 * inherits the property. Somebody who wants to delegate a section has to hold
 * the section.
 *
 * An empty set is grantable by anyone: it is a role with nothing turned on,
 * which is a real thing to want when appointing somebody before deciding what
 * they will do.
 */
export function permissionsWithin(granterHolds: readonly string[], requested: readonly string[]): boolean {
  return requested.every((permission) => grantsPermission(granterHolds, permission));
}

/** Somebody holding a platform role, and what that actually lets them do. */
export interface StaffMember {
  userId: string;
  email: string | null;
  roleCode: string;
  roleName: string;
  /** Resolved: their own set where they have one, the role's where they do not. */
  permissions: string[];
  /** True when the set above is theirs rather than the role's. */
  isCustom: boolean;
  hasMfa: boolean;
  grantedAt: number;
  grantedByEmail: string | null;
}

/** One open staff session, as the Security section lists it. Never a token — the table holds only a hash. */
export interface AdminSessionSummary {
  id: string;
  userId: string;
  email: string | null;
  ip: string | null;
  userAgent: string | null;
  mfaVerified: boolean;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number;
}

export interface AuditEntry {
  actorUserId: string | null;
  actorRole?: string | undefined;
  action: string;
  targetType?: string | undefined;
  targetId?: string | undefined;
  before?: unknown;
  after?: unknown;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

/**
 * Staff identity: who they are, what they may do, and whether this particular
 * session has proved a second factor.
 */
export class PostgresAdminRepository {
  constructor(
    private readonly sql: Sql,
    /** Encrypts TOTP secrets at rest; `mfa_credentials.secret_ref` is a sealed blob, never a raw key. */
    private readonly sealingKey: Buffer,
  ) {}

  /** Null for anyone holding no role beyond plain 'user'. */
  async resolvePrincipal(userId: string): Promise<AdminPrincipal | null> {
    const [row] = await this.sql<{ email: string | null; roles: string[]; permissions: string[]; has_mfa: boolean }[]>`
      select
        u.email,
        -- distinct: the permissions join below yields one row per permission.
        array_agg(distinct ur.role_code order by ur.role_code)                 as roles,
        coalesce(jsonb_agg(distinct p.value) filter (where p.value is not null), '[]'::jsonb) as permissions,
        exists (select 1 from mfa_credentials m where m.user_id = u.id and m.confirmed_at is not null) as has_mfa
      from users u
      join user_roles ur on ur.user_id = u.id and ur.role_code <> 'user'
      join roles r on r.code = ur.role_code
      -- The person's own set when they have one, the role's otherwise.
      --
      -- Before this the role was the only answer available, so the four seeded
      -- roles were the four possible admins and 'admin' holds ["*"]. Handing
      -- somebody the moderation queue and nothing else meant inventing a role
      -- for them, and there was no route to do even that.
      --
      -- NULL keeps the old meaning exactly, which is what makes this a
      -- widening rather than a change: every row that existed before this
      -- column did resolves the way it always did.
      left join lateral jsonb_array_elements_text(coalesce(ur.permissions, r.permissions)) p(value) on true
      where u.id = ${userId} and u.status = 'active' and u.deleted_at is null
      group by u.id, u.email
    `;
    if (!row) return null;
    return { userId, email: row.email, roles: row.roles, permissions: row.permissions, hasMfa: row.has_mfa };
  }

  // ------------------------------------------------------------------- MFA

  /**
   * Starts TOTP enrolment. The credential is unconfirmed until a code from it
   * is presented, so a half-finished enrolment cannot lock anyone out or count
   * as a second factor.
   */
  async beginTotpEnrolment(userId: string, accountLabel: string): Promise<{ secret: string; uri: string }> {
    const secret = generateTotpSecret();
    await this.sql`
      insert into mfa_credentials (user_id, kind, secret_ref, label)
      values (${userId}, 'totp', ${sealSecret(secret, this.sealingKey)}, 'default')
      on conflict (user_id, kind, label) do update
        set secret_ref = excluded.secret_ref, confirmed_at = null, created_at = now()
    `;
    return { secret, uri: totpEnrolmentUri(secret, accountLabel) };
  }

  /** Confirms enrolment and issues recovery codes. Returns them once — they are stored hashed. */
  async confirmTotpEnrolment(userId: string, code: string, atMs = Date.now()): Promise<string[]> {
    const [credential] = await this.sql<{ id: string; secret_ref: string }[]>`
      select id, secret_ref from mfa_credentials
      where user_id = ${userId} and kind = 'totp' and label = 'default'
    `;
    if (!credential) throw new AdminAuthError("mfa_not_enrolled", "Start enrolment before confirming it");
    if (!verifyTotp(openSecret(credential.secret_ref, this.sealingKey), code, atMs)) {
      throw new AdminAuthError("mfa_invalid", "That code is not correct");
    }

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(8).toString("base64url"));
    await atomically(this.sql)(async (tx) => {
      await tx`update mfa_credentials set confirmed_at = now() where id = ${credential.id}`;
      // Re-enrolling replaces the old codes; leaving them live would mean a
      // rotated second factor is still bypassable with the previous set.
      await tx`delete from mfa_recovery_codes where user_id = ${userId} and used_at is null`;
      for (const recovery of codes) {
        await tx`insert into mfa_recovery_codes (user_id, code_hash) values (${userId}, ${hashToken(recovery)})`;
      }
    });
    return codes;
  }

  /**
   * Checks a second factor: a TOTP code, or one recovery code which is then
   * spent. Returns false rather than throwing, so the caller decides what a
   * failure means.
   */
  async verifySecondFactor(userId: string, code: string, atMs = Date.now()): Promise<boolean> {
    const [credential] = await this.sql<{ id: string; secret_ref: string }[]>`
      select id, secret_ref from mfa_credentials
      where user_id = ${userId} and kind = 'totp' and confirmed_at is not null
      limit 1
    `;
    if (credential && verifyTotp(openSecret(credential.secret_ref, this.sealingKey), code, atMs)) {
      await this.sql`update mfa_credentials set last_used_at = now() where id = ${credential.id}`;
      return true;
    }

    // Single-use by construction: the UPDATE only matches an unused row, so two
    // requests racing the same code cannot both succeed.
    const spent = await this.sql<{ id: string }[]>`
      update mfa_recovery_codes set used_at = now()
      where user_id = ${userId} and code_hash = ${hashToken(code)} and used_at is null
      returning id
    `;
    return spent.length > 0;
  }

  // -------------------------------------------------------------- sessions

  /** Issues a session that authorises nothing until the second factor lands. */
  async createSession(userId: string, ip?: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateSessionToken();
    const [row] = await this.sql<{ expires_at: Date }[]>`
      insert into admin_sessions (user_id, token_hash, ip, user_agent, expires_at)
      values (${userId}, ${hashToken(token)}, ${ip ?? null}, ${userAgent ?? null},
              now() + (${ADMIN_SESSION_TTL_HOURS} * interval '1 hour'))
      returning expires_at
    `;
    return { token, expiresAt: row!.expires_at };
  }

  async markSessionMfaVerified(token: string): Promise<void> {
    await this.sql`
      update admin_sessions set mfa_verified_at = now()
      where token_hash = ${hashToken(token)} and revoked_at is null and expires_at > now()
    `;
  }

  /**
   * Resolves a staff session, re-reading roles every time.
   *
   * Permissions are not cached into the session row on purpose: revoking a role
   * has to take effect on the next request, not when the session happens to
   * expire.
   */
  async resolveSession(token: string): Promise<AdminSession | null> {
    const [row] = await this.sql<{ id: string; user_id: string; mfa_verified: boolean }[]>`
      with touched as (
        update admin_sessions set last_used_at = now()
        where token_hash = ${hashToken(token)} and revoked_at is null and expires_at > now()
          -- Idle timeout, alongside the absolute one. last_used_at has been
          -- written on every request since migration 0012 and consulted by
          -- nothing, which meant a staff session left open on a machine
          -- somebody walked away from stayed usable for the full twelve hours.
          -- coalesce, because a session that has never been used still has a
          -- creation time to be measured from.
          and coalesce(last_used_at, created_at) > now() - (${ADMIN_SESSION_IDLE_MINUTES} * interval '1 minute')
        returning id, user_id, mfa_verified_at
      )
      select id, user_id, mfa_verified_at is not null as mfa_verified from touched
    `;
    if (!row) return null;

    const principal = await this.resolvePrincipal(row.user_id);
    if (!principal) return null;
    return { ...principal, sessionId: row.id, mfaVerified: row.mfa_verified };
  }

  async revokeSession(token: string): Promise<void> {
    await this.sql`
      update admin_sessions set revoked_at = now()
      where token_hash = ${hashToken(token)} and revoked_at is null
    `;
  }

  /**
   * Every staff session currently open, for every member of staff.
   *
   * `admin_sessions` has recorded the IP, the user agent, when MFA was passed
   * and when the session was last used since migration 0012, and nothing has
   * ever read any of it. The point of showing it is the question it answers:
   * *is there a session open that I do not recognise?* — which nobody could ask
   * before, and which is the whole reason those columns were written.
   *
   * Not scoped to the caller. A second admin's live session is exactly what one
   * admin needs to be able to see, and a token still never appears — the table
   * holds only its hash.
   */
  async listSessions(): Promise<AdminSessionSummary[]> {
    const rows = await this.sql<
      {
        id: string;
        user_id: string;
        email: string | null;
        ip: string | null;
        user_agent: string | null;
        mfa_verified: boolean;
        created_at: Date;
        last_used_at: Date | null;
        expires_at: Date;
      }[]
    >`
      select session.id, session.user_id, staff.email, host(session.ip) as ip, session.user_agent,
             session.mfa_verified_at is not null as mfa_verified,
             session.created_at, session.last_used_at, session.expires_at
      from admin_sessions session
      join users staff on staff.id = session.user_id
      where session.revoked_at is null and session.expires_at > now()
      order by session.last_used_at desc nulls last, session.created_at desc
    `;
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      ip: row.ip,
      userAgent: row.user_agent,
      mfaVerified: row.mfa_verified,
      createdAt: row.created_at.getTime(),
      lastUsedAt: row.last_used_at?.getTime() ?? null,
      expiresAt: row.expires_at.getTime(),
    }));
  }

  /**
   * End one staff session by its id.
   *
   * By id rather than by token, because the point is to end somebody *else's*
   * — a laptop left at a desk, a session from an address nobody recognises.
   * Answers false when there was nothing open, so the route can say so instead
   * of implying something was undone.
   */
  async revokeSessionById(sessionId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update admin_sessions set revoked_at = now()
      where id = ${sessionId} and revoked_at is null
      returning id
    `;
    return rows.length > 0;
  }

  /** Everything except the one asking. The "I think I have been compromised" button. */
  async revokeOtherSessions(keepSessionId: string): Promise<number> {
    const rows = await this.sql<{ id: string }[]>`
      update admin_sessions set revoked_at = now()
      where revoked_at is null and expires_at > now() and id <> ${keepSessionId}
      returning id
    `;
    return rows.length;
  }

  // ----------------------------------------------------------------- audit

  /**
   * Every staff mutation writes one of these. The table is append-only — rules
   * plus a REVOKE plus a TRUNCATE trigger — so this is a record that cannot be
   * quietly tidied afterwards.
   */
  async recordAudit(entry: AuditEntry): Promise<void> {
    await this.sql`
      insert into audit_log (actor_user_id, actor_role, action, target_type, target_id, before_state, after_state, ip, user_agent)
      values (
        ${entry.actorUserId}, ${entry.actorRole ?? null}, ${entry.action},
        ${entry.targetType ?? null}, ${entry.targetId ?? null},
        ${entry.before === undefined ? null : this.sql.json(entry.before as never)},
        ${entry.after === undefined ? null : this.sql.json(entry.after as never)},
        ${entry.ip ?? null}, ${entry.userAgent ?? null}
      )
    `;
  }

  /** Should always be empty: a staff account without a second factor is the hole this closes. */
  async adminsWithoutMfa(): Promise<{ userId: string; email: string | null; roles: string[] }[]> {
    const rows = await this.sql<{ user_id: string; email: string | null; roles: string[] }[]>`
      select user_id, email, roles from v_admins_without_mfa
    `;
    return rows.map((row) => ({ userId: row.user_id, email: row.email, roles: row.roles }));
  }

  /** Bootstrapping only — the first admin is made by hand, by scripts/create-admin.ts. */
  async grantRole(userId: string, roleCode: string, grantedBy: string | null): Promise<void> {
    await this.sql`
      insert into user_roles (user_id, role_code, granted_by) values (${userId}, ${roleCode}, ${grantedBy})
      on conflict (user_id, role_code) do nothing
    `;
  }

  // ----------------------------------------------------------------- staff

  /**
   * Everyone holding a platform role, with what they can actually do.
   *
   * `permissions` is the resolved set — the person's own where they have one,
   * the role's where they do not — because that is the question being asked.
   * `isCustom` says which of the two it came from, so a screen can show
   * "moderator" and "moderator, narrowed" as different things.
   */
  async listStaff(): Promise<StaffMember[]> {
    const rows = await this.sql<
      {
        user_id: string;
        email: string | null;
        role_code: string;
        role_name: string;
        permissions: string[];
        is_custom: boolean;
        has_mfa: boolean;
        granted_at: Date;
        granted_by_email: string | null;
      }[]
    >`
      select
        ur.user_id,
        u.email,
        ur.role_code,
        r.name as role_name,
        coalesce(
          (select array_agg(value order by value) from jsonb_array_elements_text(coalesce(ur.permissions, r.permissions))),
          '{}'::text[]
        ) as permissions,
        ur.permissions is not null as is_custom,
        exists (select 1 from mfa_credentials m where m.user_id = ur.user_id and m.confirmed_at is not null) as has_mfa,
        ur.granted_at,
        granter.email as granted_by_email
      from user_roles ur
      join users u on u.id = ur.user_id
      join roles r on r.code = ur.role_code
      left join users granter on granter.id = ur.granted_by
      where ur.role_code <> 'user' and u.deleted_at is null
      order by ur.granted_at desc
    `;
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      roleCode: row.role_code,
      roleName: row.role_name,
      permissions: row.permissions,
      isCustom: row.is_custom,
      hasMfa: row.has_mfa,
      grantedAt: row.granted_at.getTime(),
      grantedByEmail: row.granted_by_email,
    }));
  }

  /** One staff member, or null for somebody who holds no platform role. */
  async staffMember(userId: string): Promise<StaffMember | null> {
    return (await this.listStaff()).find((member) => member.userId === userId) ?? null;
  }

  /**
   * Give somebody a role, optionally narrowed to a set of permissions.
   *
   * `permissions` of null means "whatever the role says", which is how every
   * row created before this column existed behaves. An array pins it.
   *
   * The subset rule is NOT enforced here. It belongs one layer up, where the
   * granter's own set is known — a repository that took both sets would be
   * inventing an authorisation model in the wrong place, and one the routes
   * could forget to use.
   */
  async upsertStaff(input: { userId: string; roleCode: string; permissions: readonly string[] | null; grantedBy: string }): Promise<void> {
    const permissions = input.permissions === null ? null : this.sql.json([...input.permissions]);
    await this.sql`
      insert into user_roles (user_id, role_code, granted_by, permissions)
      values (${input.userId}, ${input.roleCode}, ${input.grantedBy}, ${permissions})
      on conflict (user_id, role_code) do update
        set permissions = excluded.permissions, granted_by = excluded.granted_by, granted_at = now()
    `;
  }

  /**
   * Appoint somebody, making their account first when they have none.
   *
   * This is how staff get in while signup is invite-only: staff make staff, so
   * no invite is needed or spent. One transaction, so a refused write leaves no
   * account behind.
   *
   * Returns a TOTP secret when the person had no confirmed second factor,
   * because /admin refuses a password without one and there is no enrolment
   * screen. It exists in readable form only in this return value.
   */
  async appointStaff(input: {
    existingUserId: string | null;
    email: string;
    /** Required to create an account; ignored for an existing one. */
    password: string | null;
    roleCode: string;
    permissions: readonly string[] | null;
    grantedBy: string;
  }): Promise<{ userId: string; totp: { secret: string; uri: string } | null }> {
    const passwordHash = input.existingUserId === null && input.password !== null ? await hashPassword(input.password) : null;

    return (await atomically(this.sql)(async (tx) => {
      let userId = input.existingUserId;
      if (userId === null) {
        if (passwordHash === null) throw new Error("A new staff account needs a password");
        const [account] = await tx<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
        const [user] = await tx<{ id: string }[]>`
          insert into users (email, email_verified_at, password_hash, display_name, locale, personal_account_id)
          values (${input.email}, now(), ${passwordHash}, 'Staff', 'fa', ${account!.id})
          returning id
        `;
        await tx`update accounts set owner_user_id = ${user!.id} where id = ${account!.id}`;
        userId = user!.id;
      }

      const permissions = input.permissions === null ? null : tx.json([...input.permissions]);
      await tx`
        insert into user_roles (user_id, role_code, granted_by, permissions)
        values (${userId}, ${input.roleCode}, ${input.grantedBy}, ${permissions})
        on conflict (user_id, role_code) do update
          set permissions = excluded.permissions, granted_by = excluded.granted_by, granted_at = now()
      `;

      const [factor] = await tx`
        select 1 from mfa_credentials where user_id = ${userId} and kind = 'totp' and confirmed_at is not null limit 1
      `;
      if (factor) return { userId, totp: null };

      const secret = generateTotpSecret();
      await tx`
        insert into mfa_credentials (user_id, kind, secret_ref, label, confirmed_at)
        values (${userId}, 'totp', ${sealSecret(secret, this.sealingKey)}, 'default', now())
        on conflict (user_id, kind, label) do update set secret_ref = excluded.secret_ref, confirmed_at = now()
      `;
      return { userId, totp: { secret, uri: totpEnrolmentUri(secret, input.email) } };
    })) as { userId: string; totp: { secret: string; uri: string } | null };
  }

  /**
   * Take a platform role away.
   *
   * The user row stays: somebody who leaves is still the author of every audit
   * entry they wrote, and deleting the account would orphan them. What goes is
   * the ability to act.
   */
  async revokeStaff(userId: string, roleCode: string): Promise<boolean> {
    const rows = await this.sql`
      delete from user_roles where user_id = ${userId} and role_code = ${roleCode} and role_code <> 'user'
    `;
    return rows.count > 0;
  }

  /** The roles a new member of staff can be given, with what each one implies. */
  async roles(): Promise<{ code: string; name: string; permissions: string[] }[]> {
    const rows = await this.sql<{ code: string; name: string; permissions: string[] }[]>`
      select code, name,
             coalesce((select array_agg(value order by value) from jsonb_array_elements_text(permissions)), '{}'::text[]) as permissions
      from roles where code <> 'user' order by code
    `;
    return rows.map((row) => ({ code: row.code, name: row.name, permissions: row.permissions }));
  }

  /** Find a person by email, so staff are appointed by the address they already sign in with. */
  async findUserByEmail(email: string): Promise<{ id: string; email: string | null } | null> {
    const [row] = await this.sql<{ id: string; email: string | null }[]>`
      select id, email from users where email = ${email} and deleted_at is null and status = 'active'
    `;
    return row ?? null;
  }
}
