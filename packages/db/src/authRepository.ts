import type { CustomerSessionUser } from "@vgen/contracts";
import { coinsToMicroCredits, generateOtpCode, generateSessionToken, hashPassword, hashPhone, hashToken, verifyPassword } from "@vgen/core";
import type { Sql, TransactionSql } from "postgres";
import { atomically } from "./transaction";

/**
 * The free trial, granted once per phone number rather than once per account.
 *
 * `trial_grants` is keyed by a hash of the phone and deliberately survives
 * account deletion, so deleting and re-creating an account does not mint
 * another one.
 */
export const TRIAL_COINS = 12;
export const TRIAL_TTL_DAYS = 14;

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;
const SESSION_TTL_DAYS = 30;

export type LoginMethod = "password" | "otp" | "oauth";

export class AuthError extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "invite_required"
      | "invite_invalid"
      | "otp_invalid"
      | "otp_expired"
      | "otp_exhausted"
      | "account_taken"
      | "account_suspended",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface SignupContext {
  inviteCode?: string | undefined;
  deviceFingerprint?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
  locale?: "fa" | "en" | undefined;
}

export interface StartedVerification {
  /** The code to send. Never stored in the clear, so this is the only chance to read it. */
  code: string;
  expiresAt: Date;
}

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  display_name: string | null;
  locale: string;
  status: string;
  personal_account_id: string | null;
};

function publicUser(row: UserRow): CustomerSessionUser {
  return {
    id: row.id,
    methods: ["email"],
    // The contract has always described a customer by email. A phone-only
    // account has none, and inventing one would be a lie the client stores;
    // the placeholder domain is reserved by RFC 2606 and cannot be delivered to.
    emailNormalized: row.email ?? `${row.id}@phone.invalid`,
    ...(row.display_name ? { displayName: row.display_name } : {}),
    locale: row.locale === "en" ? "en" : "fa",
    isTeam: false,
  };
}

/**
 * Everything that creates or authenticates a person.
 *
 * The invariant this file exists to hold: a new account is created in ONE
 * transaction that also settles its account row, its trial, its invite
 * redemption and its device record. Any of those landing separately produces a
 * user who is half signed up — with no balance, or with a trial they should not
 * have had, or admitted by a code that never recorded them.
 */
export class PostgresAuthRepository {
  constructor(
    private readonly sql: Sql,
    private readonly phonePepper: string,
  ) {}

  // ---------------------------------------------------------------- phone OTP

  async startPhoneVerification(phoneE164: string, ip?: string): Promise<StartedVerification> {
    const code = generateOtpCode();
    const [row] = await this.sql<{ expires_at: Date }[]>`
      insert into phone_verifications (phone, code_hash, max_attempts, ip, expires_at)
      values (${phoneE164}, ${hashToken(code)}, ${OTP_MAX_ATTEMPTS}, ${ip ?? null},
              now() + (${OTP_TTL_MINUTES} * interval '1 minute'))
      returning expires_at
    `;
    return { code, expiresAt: row!.expires_at };
  }

  /**
   * Consumes a code, counting the attempt whether or not it was right.
   *
   * One statement, and that is the whole point. The obvious version — read the
   * row, compare, UPDATE the counter, then throw — loses the increment: the
   * throw rolls the transaction back and takes the count with it, so an
   * attacker gets unlimited guesses at a six-digit code and the attempts column
   * sits at zero the entire time.
   *
   * Here the UPDATE always runs and always increments; `consumed_at` is only
   * set when the code was right, unexpired and within budget. The comparisons
   * see the pre-increment value, and the failure is decided afterwards from
   * what came back.
   */
  async verifyPhoneCode(phoneE164: string, code: string): Promise<void> {
    const codeHash = hashToken(code);
    const [attempt] = await this.sql<{ consumed: boolean; expired: boolean; exhausted: boolean; code_ok: boolean }[]>`
      update phone_verifications
      set attempts = attempts + 1,
          consumed_at = case
            when code_hash = ${codeHash} and expires_at > now() and attempts < max_attempts then now()
            else null
          end
      where id = (
        select id from phone_verifications
        where phone = ${phoneE164} and consumed_at is null
        order by sent_at desc
        limit 1
      )
      returning
        consumed_at is not null as consumed,
        expires_at <= now()    as expired,
        attempts > max_attempts as exhausted,
        code_hash = ${codeHash} as code_ok
    `;

    if (!attempt) throw new AuthError("otp_invalid", "No verification is pending for this number");
    if (attempt.consumed) return;
    if (attempt.expired) throw new AuthError("otp_expired", "That code has expired");
    if (attempt.exhausted) throw new AuthError("otp_exhausted", "Too many attempts");
    throw new AuthError("otp_invalid", "That code is not correct");
  }

  // ------------------------------------------------------------------ signup

  /** Signs in an existing phone user, or creates one. Call only after verifyPhoneCode. */
  async signInWithPhone(phoneE164: string, context: SignupContext = {}): Promise<CustomerSessionUser> {
    const existing = await this.findUserByPhone(phoneE164);
    if (existing) return this.assertActive(existing);
    return this.createAccount({ phone: phoneE164 }, context);
  }

  async registerWithPassword(email: string, password: string, context: SignupContext = {}): Promise<CustomerSessionUser> {
    const normalized = email.trim().toLowerCase();
    const [taken] = await this.sql<{ id: string }[]>`select id from users where email = ${normalized} limit 1`;
    if (taken) throw new AuthError("account_taken", "That email already has an account");
    return this.createAccount({ email: normalized, passwordHash: await hashPassword(password) }, context);
  }

  async loginWithPassword(email: string, password: string): Promise<CustomerSessionUser> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.sql<(UserRow & { password_hash: string | null })[]>`
      select id, email, phone, display_name, locale, status, personal_account_id, password_hash
      from users where email = ${normalized} limit 1
    `;
    // Hash even when the user does not exist, so a missing account and a wrong
    // password take the same time and the endpoint cannot be used to enumerate
    // who has signed up.
    const stored = row?.password_hash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA";
    const matched = await verifyPassword(password, stored);
    if (!row || !matched) throw new AuthError("invalid_credentials", "Email or password is not correct");
    return this.assertActive(row);
  }

  /** Google and friends. `providerUid` is the provider's stable subject claim. */
  async signInWithOAuth(
    provider: "google" | "github" | "apple",
    providerUid: string,
    email: string | null,
    displayName: string | null,
    context: SignupContext = {},
  ): Promise<CustomerSessionUser> {
    const [linked] = await this.sql<UserRow[]>`
      select u.id, u.email, u.phone, u.display_name, u.locale, u.status, u.personal_account_id
      from auth_identities i join users u on u.id = i.user_id
      where i.provider = ${provider} and i.provider_uid = ${providerUid}
      limit 1
    `;
    if (linked) return this.assertActive(linked);

    const normalized = email?.trim().toLowerCase() ?? null;
    if (normalized) {
      // Same verified email, different provider: link rather than fork the
      // account, or the customer loses their balance by signing in differently.
      const [byEmail] = await this.sql<UserRow[]>`
        select id, email, phone, display_name, locale, status, personal_account_id
        from users where email = ${normalized} limit 1
      `;
      if (byEmail) {
        await this.sql`
          insert into auth_identities (user_id, provider, provider_uid, email)
          values (${byEmail.id}, ${provider}, ${providerUid}, ${normalized})
          on conflict (provider, provider_uid) do nothing
        `;
        return this.assertActive(byEmail);
      }
    }

    return this.createAccount({ email: normalized, displayName, identity: { provider, providerUid } }, context);
  }

  /**
   * The one transaction that makes a whole account.
   *
   * accounts and users reference each other, so the account is inserted first
   * without an owner and adopted once the user exists.
   */
  private async createAccount(
    identity: {
      email?: string | null;
      phone?: string | null;
      passwordHash?: string | null;
      displayName?: string | null;
      identity?: { provider: string; providerUid: string } | undefined;
    },
    context: SignupContext,
  ): Promise<CustomerSessionUser> {
    const gateOpen = await this.isSignupOpen();
    if (!gateOpen && !context.inviteCode) {
      throw new AuthError("invite_required", "DEEV is in early access and needs an invite code");
    }

    return (await atomically(this.sql)(async (tx) => {
      const [account] = await tx<{ id: string }[]>`
        insert into accounts (kind) values ('personal') returning id
      `;
      // Both channels are verified before this is reached — OAuth and the OTP
      // flow each prove their own — so the timestamps are set here rather than
      // left for a confirmation step that has already happened.
      const verifiedAt = new Date();
      const [user] = await tx<UserRow[]>`
        insert into users (email, phone, password_hash, display_name, locale, personal_account_id,
                           email_verified_at, phone_verified_at)
        values (${identity.email ?? null}, ${identity.phone ?? null}, ${identity.passwordHash ?? null},
                ${identity.displayName ?? null}, ${context.locale ?? "fa"}, ${account!.id},
                ${identity.email && !identity.passwordHash ? verifiedAt : null},
                ${identity.phone ? verifiedAt : null})
        returning id, email, phone, display_name, locale, status, personal_account_id
      `;
      await tx`update accounts set owner_user_id = ${user!.id} where id = ${account!.id}`;

      if (identity.identity) {
        await tx`
          insert into auth_identities (user_id, provider, provider_uid, email)
          values (${user!.id}, ${identity.identity.provider}, ${identity.identity.providerUid}, ${identity.email ?? null})
        `;
      }

      if (context.inviteCode) {
        try {
          await tx`select redeem_invite(${context.inviteCode}, ${user!.id}, ${account!.id}, ${context.ip ?? null})`;
        } catch (error) {
          // The invite is the gate. A bad code must fail the signup, not create
          // an account that slipped past it.
          throw new AuthError("invite_invalid", error instanceof Error ? error.message : "That invite code is not valid");
        }
      }

      if (identity.phone) await this.grantTrial(tx, account!.id, identity.phone);

      if (context.deviceFingerprint) {
        await tx`
          insert into device_fingerprints (fingerprint_hash, account_id, user_id, seen_at_signup, ip)
          values (${context.deviceFingerprint}, ${account!.id}, ${user!.id}, true, ${context.ip ?? null})
          on conflict (fingerprint_hash, account_id) do update set last_seen_at = now()
        `;
      }

      return publicUser(user!);
    })) as CustomerSessionUser;
  }

  /**
   * One trial per phone number, ever.
   *
   * The insert is the lock: `trial_grants` is keyed by the phone hash, so a
   * second attempt conflicts and grants nothing. Checking first and inserting
   * after would let two concurrent signups both pass the check.
   */
  private async grantTrial(tx: TransactionSql, accountId: string, phoneE164: string): Promise<void> {
    const phoneHash = hashPhone(phoneE164, this.phonePepper);
    const claimed = await tx<{ phone_hash: string }[]>`
      insert into trial_grants (phone_hash, account_id, micro_credits)
      values (${phoneHash}, ${accountId}, ${coinsToMicroCredits(TRIAL_COINS)})
      on conflict (phone_hash) do nothing
      returning phone_hash
    `;
    if (claimed.length === 0) return;

    const [lot] = await tx<{ grant_credits: string }[]>`
      select grant_credits(${accountId}, 'signup_bonus', ${coinsToMicroCredits(TRIAL_COINS)},
                           now() + (${TRIAL_TTL_DAYS} * interval '1 day'), 'DEEV trial') as grant_credits
    `;
    await tx`update trial_grants set lot_id = ${lot!.grant_credits} where phone_hash = ${phoneHash}`;
  }

  /** True once early access is over and anyone may sign up without an invite. */
  private async isSignupOpen(): Promise<boolean> {
    const [row] = await this.sql<{ is_enabled: boolean }[]>`
      select is_enabled from feature_flags where code = 'early_access'
    `;
    // A missing row is treated as "gate still up". Failing the other way would
    // turn a deleted flag into an open signup page, silently.
    const gateUp = row?.is_enabled ?? true;
    return !gateUp;
  }

  private async findUserByPhone(phoneE164: string): Promise<UserRow | undefined> {
    const [row] = await this.sql<UserRow[]>`
      select id, email, phone, display_name, locale, status, personal_account_id
      from users where phone = ${phoneE164} limit 1
    `;
    return row;
  }

  private assertActive(row: UserRow): CustomerSessionUser {
    if (row.status !== "active") throw new AuthError("account_suspended", "This account is not active");
    return publicUser(row);
  }

  // ---------------------------------------------------------------- sessions

  async createSession(userId: string, ip?: string, userAgent?: string): Promise<{ token: string; expiresAt: Date }> {
    const token = generateSessionToken();
    const [row] = await this.sql<{ expires_at: Date }[]>`
      insert into sessions (user_id, token_hash, ip, user_agent, expires_at)
      values (${userId}, ${hashToken(token)}, ${ip ?? null}, ${userAgent ?? null},
              now() + (${SESSION_TTL_DAYS} * interval '1 day'))
      returning expires_at
    `;
    return { token, expiresAt: row!.expires_at };
  }

  async resolveSession(token: string): Promise<CustomerSessionUser | null> {
    // Looked up by hash, so the table never holds anything usable as a
    // credential. The touch and the read are one statement because this runs on
    // every authenticated request and a second round trip there is not free.
    const [row] = await this.sql<UserRow[]>`
      with touched as (
        update sessions
        set last_used_at = now()
        where token_hash = ${hashToken(token)}
          and revoked_at is null
          and expires_at > now()
        returning user_id
      )
      select u.id, u.email, u.phone, u.display_name, u.locale, u.status, u.personal_account_id
      from users u
      join touched t on t.user_id = u.id
    `;
    if (!row || row.status !== "active") return null;
    return publicUser(row);
  }

  async revokeSession(token: string): Promise<void> {
    await this.sql`update sessions set revoked_at = now() where token_hash = ${hashToken(token)} and revoked_at is null`;
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sql`update sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  }

  // ------------------------------------------------------------- abuse signal

  async recordLoginAttempt(input: {
    identifier: string;
    userId?: string | undefined;
    method: LoginMethod;
    succeeded: boolean;
    failureReason?: string | undefined;
    ip?: string | undefined;
    userAgent?: string | undefined;
  }): Promise<void> {
    await this.sql`
      insert into login_attempts (identifier, user_id, method, succeeded, failure_reason, ip, user_agent)
      values (${input.identifier}, ${input.userId ?? null}, ${input.method}, ${input.succeeded},
              ${input.failureReason ?? null}, ${input.ip ?? null}, ${input.userAgent ?? null})
    `;
  }

  /** Lockout is derived from a rolling window, never stored — so it also expires by itself. */
  async recentLoginFailures(identifier: string, windowMinutes = 15): Promise<number> {
    const [row] = await this.sql<{ count: number }[]>`
      select recent_login_failures(${identifier}, ${`${windowMinutes} minutes`}::interval) as count
    `;
    return row?.count ?? 0;
  }
}
