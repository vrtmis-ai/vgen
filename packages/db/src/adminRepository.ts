import {
  generateSessionToken,
  generateTotpSecret,
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
        array_agg(ur.role_code order by ur.role_code)                          as roles,
        coalesce(jsonb_agg(distinct p.value) filter (where p.value is not null), '[]'::jsonb) as permissions,
        exists (select 1 from mfa_credentials m where m.user_id = u.id and m.confirmed_at is not null) as has_mfa
      from users u
      join user_roles ur on ur.user_id = u.id and ur.role_code <> 'user'
      join roles r on r.code = ur.role_code
      left join lateral jsonb_array_elements_text(r.permissions) p(value) on true
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

  /** Bootstrapping only — there is no route for this. The first admin is made by hand. */
  async grantRole(userId: string, roleCode: string, grantedBy: string | null): Promise<void> {
    await this.sql`
      insert into user_roles (user_id, role_code, granted_by) values (${userId}, ${roleCode}, ${grantedBy})
      on conflict (user_id, role_code) do nothing
    `;
  }
}
