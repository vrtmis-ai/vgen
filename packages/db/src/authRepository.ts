import type { CustomerSessionUser } from "@vgen/contracts";
import {
  coinsToMicroCredits,
  generateOtpCode,
  generateSessionToken,
  hashPassword,
  hashPhone,
  hashToken,
  mintHandle,
  normalizeHandle,
  verifyPassword,
} from "@vgen/core";
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
/* A reset link sitting in a mailbox is a password until it expires, so it does
   not sit there long. An hour is enough to find the mail on another device and
   short enough that a forgotten one stops mattering the same afternoon. */
const PASSWORD_RESET_TTL_MINUTES = 60;

export type LoginMethod = "password" | "otp" | "oauth";

export class AuthError extends Error {
  constructor(
    readonly code:
      | "invalid_credentials"
      | "invite_required"
      | "invite_invalid"
      | "invite_bound"
      | "otp_invalid"
      | "otp_expired"
      | "otp_exhausted"
      | "account_taken"
      | "handle_taken"
      | "handle_invalid"
      | "account_suspended"
      | "reset_invalid"
      | "reset_expired"
      | "reset_used",
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
  /**
   * The terms this account was created against, recorded with the moment.
   *
   * The undertaking the owner signs to eNamad should be backed by one the user
   * signed to DEEV. A boolean would answer "did they agree" and not "to what",
   * and terms change — the version is the only thing that makes the record
   * mean anything a year later.
   *
   * Optional so a caller that has nothing to say leaves the pair null rather
   * than recording a consent nobody gave.
   */
  termsVersion?: string | undefined;
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
  handle: string;
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
    handle: row.handle,
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
   * Checks a code and counts the attempt, whether or not it was right.
   *
   * One statement, and that is the whole point. The obvious version — read the
   * row, compare, UPDATE the counter, then throw — loses the increment: the
   * throw rolls the transaction back and takes the count with it, so an
   * attacker gets unlimited guesses at a six-digit code and the attempts column
   * sits at zero the entire time.
   *
   * Here the UPDATE always runs and always increments. The comparisons see the
   * pre-increment value, and the failure is decided afterwards from what came
   * back.
   *
   * It deliberately does NOT consume the code — `consumePhoneCode` does, and
   * only once the sign-in it authorises has actually happened. See
   * `signInWithPhoneCode` for why those had to come apart.
   */
  async verifyPhoneCode(phoneE164: string, code: string): Promise<void> {
    const codeHash = hashToken(code);
    const [attempt] = await this.sql<{ correct: boolean; expired: boolean; exhausted: boolean }[]>`
      update phone_verifications
      set attempts = attempts + 1
      where id = (
        select id from phone_verifications
        where phone = ${phoneE164} and consumed_at is null
        order by sent_at desc
        limit 1
      )
      returning
        code_hash = ${codeHash} as correct,
        expires_at <= now()     as expired,
        attempts > max_attempts as exhausted
    `;

    if (!attempt) throw new AuthError("otp_invalid", "No verification is pending for this number");
    if (attempt.expired) throw new AuthError("otp_expired", "That code has expired");
    if (attempt.exhausted) throw new AuthError("otp_exhausted", "Too many attempts");
    if (!attempt.correct) throw new AuthError("otp_invalid", "That code is not correct");
  }

  /**
   * Spends the code. Returns false if someone else already did.
   *
   * The `consumed_at is null` predicate is the mutex: two requests racing with
   * the same correct code both reach here, one wins the row lock, and the other
   * re-evaluates the predicate after it commits and updates nothing.
   */
  private async consumePhoneCode(tx: TransactionSql, phoneE164: string, code: string): Promise<boolean> {
    const consumed = await tx<{ id: string }[]>`
      update phone_verifications
      set consumed_at = now()
      where id = (
        select id from phone_verifications
        where phone = ${phoneE164} and code_hash = ${hashToken(code)} and consumed_at is null
        order by sent_at desc
        limit 1
      )
      returning id
    `;
    return consumed.length > 0;
  }

  /**
   * Verify a code and sign in, spending the code only if the sign-in happened.
   *
   * These used to be two calls in the route with nothing joining them, and the
   * order was fatal: `verifyPhoneCode` committed `consumed_at` the moment the
   * code matched, then `signInWithPhone` threw `invite_required`. So the 403
   * that ASKED for an invite code was the same request that destroyed the code
   * needed to supply one. Every invite-gated phone signup — the route most
   * Iranian users take — dead-ended on "that code is not right", about a code
   * the user had just typed correctly, with the resend button disabled for
   * another minute.
   *
   * The three things that all have to hold at once, and why the split is shaped
   * like this:
   *
   *   - a wrong guess must still be counted, so the attempt lands in its own
   *     committed statement OUTSIDE the transaction below, where no rollback
   *     can reach it;
   *   - a refused signup must leave the code usable, so the consume is INSIDE
   *     the transaction and goes back when the signup throws;
   *   - two requests must not both spend one code, so the consume keeps its
   *     `consumed_at is null` predicate and stays the mutex it always was.
   */
  async signInWithPhoneCode(phoneE164: string, code: string, context: SignupContext = {}): Promise<CustomerSessionUser> {
    await this.verifyPhoneCode(phoneE164, code);

    return (await atomically(this.sql)(async (tx) => {
      if (!(await this.consumePhoneCode(tx, phoneE164, code))) {
        throw new AuthError("otp_invalid", "That code has already been used");
      }
      // Bound to the transaction, so an invite failure inside `createAccount`
      // rolls the consume back with it. Calling `this.signInWithPhone` would
      // run on the pool connection instead and commit the account separately.
      //
      // The cast is postgres.js's type split, not a lie about the value: a
      // TransactionSql is a Sql that also has savepoint(), and `atomically`
      // already picks between begin() and savepoint() so nesting works.
      return new PostgresAuthRepository(tx as unknown as Sql, this.phonePepper).signInWithPhone(phoneE164, context);
    })) as CustomerSessionUser;
  }

  // ------------------------------------------------------------------ signup

  /** Signs in an existing phone user, or creates one. Call only after verifyPhoneCode. */
  async signInWithPhone(phoneE164: string, context: SignupContext = {}): Promise<CustomerSessionUser> {
    const existing = await this.findUserByPhone(phoneE164);
    if (existing) return this.assertActive(existing);
    return this.createAccount({ phone: phoneE164 }, context);
  }

  async registerWithPassword(email: string, password: string, handle: string, context: SignupContext = {}): Promise<CustomerSessionUser> {
    const normalized = email.trim().toLowerCase();
    const wanted = normalizeHandle(handle);
    if (!wanted) throw new AuthError("handle_invalid", "That is not a username");

    const [taken] = await this.sql<{ id: string }[]>`select id from users where email = ${normalized} limit 1`;
    if (taken) throw new AuthError("account_taken", "That email already has an account");
    /* Checked before the insert so the message names the right field — the
       unique index would refuse it either way, but "that email already has an
       account" for a taken *username* is the kind of wrong answer that costs
       somebody twenty minutes. The insert still races; see createAccount. */
    const [used] = await this.sql<{ id: string }[]>`select id from users where handle = ${wanted} limit 1`;
    if (used) throw new AuthError("handle_taken", "That username is taken");

    return this.createAccount({ email: normalized, handle: wanted, passwordHash: await hashPassword(password) }, context);
  }

  /**
   * What somebody may change about themselves.
   *
   * Only their own row, by construction: the id comes from the session cookie
   * and there is no parameter for anyone else's. A handle collision is the
   * expected outcome rather than an exception — two people want `sara` — so it
   * comes back as a named refusal, not a 23505 leaking out of the driver.
   */
  async updateProfile(
    userId: string,
    changes: { handle?: string | undefined; displayName?: string | undefined },
  ): Promise<CustomerSessionUser> {
    const handle = changes.handle === undefined ? null : normalizeHandle(changes.handle);
    if (changes.handle !== undefined && handle === null) throw new AuthError("handle_invalid", "That is not a username");

    if (handle !== null) {
      const [used] = await this.sql<{ id: string }[]>`select id from users where handle = ${handle} and id <> ${userId} limit 1`;
      if (used) throw new AuthError("handle_taken", "That username is taken");
    }

    const [row] = await this.sql<UserRow[]>`
      update users set
        handle = coalesce(${handle}, handle),
        display_name = coalesce(${changes.displayName ?? null}, display_name),
        updated_at = now()
      where id = ${userId} and deleted_at is null
      returning id, email, phone, handle, display_name, locale, status, personal_account_id
    `;
    if (!row) throw new AuthError("invalid_credentials", "No such account");
    return publicUser(row);
  }

  async loginWithPassword(email: string, password: string): Promise<CustomerSessionUser> {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.sql<(UserRow & { password_hash: string | null })[]>`
      select id, email, phone, handle, display_name, locale, status, personal_account_id, password_hash
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

  /**
   * Google and friends. `providerUid` is the provider's stable subject claim.
   *
   * `email` must be null unless the provider *proved* the address belongs to
   * this person. The block below links a new identity onto whichever user
   * already holds that address, so an unverified one is a way into somebody
   * else's account — see `emailIsVerified` in the Microsoft client, where the
   * evidence is weaker than Google's and the rule is spelled out.
   */
  async signInWithOAuth(
    provider: "google" | "microsoft" | "github" | "apple",
    providerUid: string,
    email: string | null,
    displayName: string | null,
    context: SignupContext = {},
  ): Promise<CustomerSessionUser> {
    const [linked] = await this.sql<UserRow[]>`
      select u.id, u.email, u.phone, u.handle, u.display_name, u.locale, u.status, u.personal_account_id
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
        select id, email, phone, handle, display_name, locale, status, personal_account_id
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
      /** Chosen at sign-up where there is a form to choose on; minted otherwise. */
      handle?: string | null;
      identity?: { provider: string; providerUid: string } | undefined;
    },
    context: SignupContext,
  ): Promise<CustomerSessionUser> {
    const gateOpen = await this.isSignupOpen();
    if (!gateOpen && !context.inviteCode) {
      throw new AuthError("invite_required", "DEEV is in early access and needs an invite code");
    }

    return (await atomically(this.sql)(async (tx) => {
      /* A waitlist code belongs to the address it was mailed to.
         Checked on the server and not merely locked in the form, because a
         field the browser will not let you edit is a field curl has never
         heard of. Inside the transaction, so the binding cannot change between
         the read and the insert that relies on it.
         Campaign codes have no binding and are unaffected: they are meant to
         admit whoever holds them. */
      if (context.inviteCode) {
        const [bound] = await tx<{ channel: "email" | "phone"; contact: string }[]>`
          select entry.channel, entry.contact::text as contact
          from waitlist_entries entry
          join invite_codes invite on invite.id = entry.invite_code_id
          where invite.code = ${context.inviteCode.trim()}
          limit 1
        `;
        if (bound) {
          const offered = bound.channel === "email" ? (identity.email ?? null) : (identity.phone ?? null);
          // citext on the column, so the comparison is folded the same way the
          // queue folded it when the place was taken.
          if (!offered || offered.trim().toLowerCase() !== bound.contact.trim().toLowerCase()) {
            throw new AuthError("invite_bound", "That invite code was issued to a different address.");
          }
        }
      }

      const [account] = await tx<{ id: string }[]>`
        insert into accounts (kind) values ('personal') returning id
      `;
      // Both channels are verified before this is reached — OAuth and the OTP
      // flow each prove their own — so the timestamps are set here rather than
      // left for a confirmation step that has already happened.
      const verifiedAt = new Date();
      /* `users.handle` is NOT NULL from migration 0036, and the OAuth and phone
         paths have no form to ask on — so one is minted from whatever identity
         we have. The retry below covers the race and the ordinary collision:
         two people called `sara` at different domains. */
      const handle = identity.handle ?? mintHandle(identity.email?.split("@")[0] ?? identity.phone ?? "");
      const [user] = await tx<UserRow[]>`
        insert into users (email, phone, handle, password_hash, display_name, locale, personal_account_id,
                           email_verified_at, phone_verified_at, terms_accepted_at, terms_version)
        values (${identity.email ?? null}, ${identity.phone ?? null}, ${handle}, ${identity.passwordHash ?? null},
                ${identity.displayName ?? null}, ${context.locale ?? "fa"}, ${account!.id},
                ${identity.email && !identity.passwordHash ? verifiedAt : null},
                ${identity.phone ? verifiedAt : null},
                -- Written here and nowhere else: every way of creating an
                -- account -- password, phone code, and each OAuth provider --
                -- funnels through this insert, so recording it once covers all
                -- of them and a route added next year cannot forget.
                ${context.termsVersion ? verifiedAt : null}, ${context.termsVersion ?? null})
        returning id, email, phone, handle, display_name, locale, status, personal_account_id
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
        } catch {
          // The invite is the gate. A bad code must fail the signup, not create
          // an account that slipped past it.
          // The same words whichever rule refused it. redeem_invite() says
          // "invite_revoked: CODE" or "invite_exhausted: CODE", and passing that
          // on told anyone guessing codes which guesses were real.
          throw new AuthError("invite_invalid", "That invite code is not valid");
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

  /**
   * Whether a code would admit someone right now — the same five conditions
   * redeem_invite() checks, read without redeeming.
   *
   * A yes or a no and nothing else: which condition failed is for the
   * console, not for somebody typing codes at the front door.
   */
  /**
   * Who a waitlist invite was issued to, or null for a code that is not one.
   *
   * A campaign code admits anybody who has it. A waitlist code was created for
   * one person, mailed to one address, and admits that person — this is what
   * tells the two apart, and what the sign-up form fills its locked field from.
   *
   * Deliberately says nothing about whether the code is still usable. That is
   * `isInviteUsable`'s question and the redemption's after it; answering both
   * here would mean two rules about who gets in, which is how they come to
   * disagree.
   */
  async inviteBinding(code: string): Promise<{ kind: "email" | "phone"; value: string } | null> {
    const [row] = await this.sql<{ channel: "email" | "phone"; contact: string }[]>`
      select entry.channel, entry.contact::text as contact
      from waitlist_entries entry
      join invite_codes invite on invite.id = entry.invite_code_id
      where invite.code = ${code.trim()}
      limit 1
    `;
    return row ? { kind: row.channel, value: row.contact } : null;
  }

  async isInviteUsable(code: string): Promise<boolean> {
    const [row] = await this.sql<{ usable: boolean }[]>`
      select exists (
        select 1 from invite_codes
        where code = ${code.trim()}
          and is_active and revoked_at is null
          and starts_at <= now()
          and (expires_at is null or expires_at > now())
          and (max_redemptions is null or redemption_count < max_redemptions)
      ) as usable
    `;
    return row?.usable === true;
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
      select id, email, phone, handle, display_name, locale, status, personal_account_id
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
    const hash = hashToken(token);
    // Looked up by hash, so the table never holds anything usable as a
    // credential. The touch and the read are one statement because this runs on
    // every authenticated request and a second round trip there is not free.
    //
    // **The touch is throttled and the read is not.** This used to be a single
    // UPDATE whose returned row *was* the lookup, which made every
    // authenticated GET a write. Two things came of that. Every read produced a
    // WAL record, so no read replica could ever serve one; and because the
    // write took a row lock, requests sharing a session queued behind each
    // other — a load test measured 445 requests a second on one session against
    // 2,329 on two hundred, the same server, entirely on that lock. The browser
    // opens a screen by firing three of these at once.
    //
    // Five minutes is chosen against what reads the column, which today is
    // nothing: `last_used_at` on *customer* sessions has no reader in the
    // product. It is kept for support and forensics — "when was this session
    // last active" — and five-minute granularity answers that question exactly
    // as well. Note this is not the staff table: `admin_sessions.last_used_at`
    // drives an idle timeout and is deliberately left alone.
    //
    // The CTE is not referenced by the SELECT below and still runs. A
    // data-modifying statement in WITH is executed exactly once and always to
    // completion, whether or not the primary query reads its output.
    const [row] = await this.sql<UserRow[]>`
      with touched as (
        update sessions
        set last_used_at = now()
        where token_hash = ${hash}
          and revoked_at is null
          and expires_at > now()
          and (last_used_at is null or last_used_at < now() - interval '5 minutes')
        returning 1
      )
      select u.id, u.email, u.phone, u.handle, u.display_name, u.locale, u.status, u.personal_account_id
      from sessions s
      join users u on u.id = s.user_id
      where s.token_hash = ${hash}
        and s.revoked_at is null
        and s.expires_at > now()
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

  // ----------------------------------------------------------- password reset

  /**
   * Mint a link that lets somebody who has forgotten their password set a new
   * one.
   *
   * `auth_tokens` has been waiting for this since 0005: hashed, single-use,
   * expiring, already swept nightly by `purge_security_logs` and already
   * deleted with the account. Only the hash is stored, exactly as `sessions`
   * stores a session token — a database dump is not a set of reset links.
   *
   * The plaintext token is returned **once**, to the caller that mails it.
   * Nothing reads it back afterwards, here or anywhere.
   *
   * Three answers, because there are three situations and telling them apart
   * is the whole point of the screen that calls this:
   *  - `no_account` — nobody has this address. Said plainly, by the owner's
   *    decision; the waitlist already reveals as much, and silence here leaves
   *    somebody who typed their address wrong waiting for a mail forever.
   *  - `other_method` — the account exists and has no password, because it
   *    signs in with Google or by phone. No token is minted for a password
   *    that does not exist; the caller mails an explanation instead.
   *  - `sent` — here is the token, go and mail it.
   *
   * Asking twice leaves exactly one live link: the earlier ones are consumed
   * in the same transaction that mints the new one, so a forwarded old mail
   * stops working the moment a new one is asked for.
   */
  async startPasswordReset(
    email: string,
    context: { ip?: string | undefined; userAgent?: string | undefined } = {},
  ): Promise<
    | { kind: "sent"; userId: string; token: string }
    | { kind: "no_account" }
    | { kind: "other_method"; userId: string; method: "oauth" | "phone" }
  > {
    const normalized = email.trim().toLowerCase();
    const [row] = await this.sql<{ id: string; password_hash: string | null; provider: string | null }[]>`
      select u.id, u.password_hash,
             (select i.provider from auth_identities i where i.user_id = u.id limit 1) as provider
      from users u where u.email = ${normalized} limit 1
    `;
    if (!row) return { kind: "no_account" };
    if (!row.password_hash) return { kind: "other_method", userId: row.id, method: row.provider ? "oauth" : "phone" };

    const token = generateSessionToken();
    await atomically(this.sql)(async (tx) => {
      await tx`
        update auth_tokens set consumed_at = now()
        where user_id = ${row.id} and purpose = 'password_reset' and consumed_at is null
      `;
      await tx`
        insert into auth_tokens (user_id, purpose, token_hash, ip, user_agent, expires_at)
        values (${row.id}, 'password_reset', ${hashToken(token)}, ${context.ip ?? null}, ${context.userAgent ?? null},
                now() + (${PASSWORD_RESET_TTL_MINUTES} * interval '1 minute'))
      `;
    });
    return { kind: "sent", userId: row.id, token };
  }

  /**
   * What a link is worth, before anybody types a new password into the page it
   * opens. A dead link should say which kind of dead it is — expired, already
   * used, or never ours — rather than accept a password and then refuse it.
   */
  async checkPasswordReset(token: string): Promise<"usable" | "expired" | "used" | "unknown"> {
    const [row] = await this.sql<{ consumed: boolean; expired: boolean }[]>`
      select consumed_at is not null as consumed, expires_at <= now() as expired
      from auth_tokens
      where purpose = 'password_reset' and token_hash = ${hashToken(token)}
      limit 1
    `;
    if (!row) return "unknown";
    if (row.consumed) return "used";
    return row.expired ? "expired" : "usable";
  }

  /**
   * Spend the link and set the password.
   *
   * Shaped like `consumePhoneCode`: the `consumed_at is null` predicate is the
   * mutex, so two submissions of one link cannot both win — the loser updates
   * nothing and is told the link was already used. Expiry is judged from the
   * row the update returned rather than in the predicate, so the refusal can
   * name the right reason. Throwing rolls the consume back, which is correct:
   * an expired link is dead by the clock and does not need spending too.
   *
   * Every session is revoked in the same transaction. If the reason for the
   * reset is that somebody else got in, leaving their session alive would
   * defeat the whole exercise. Nobody is signed in here either — the new
   * password is typed on the sign-in screen, so a mail link never becomes a
   * session by itself.
   */
  async completePasswordReset(token: string, password: string): Promise<void> {
    await atomically(this.sql)(async (tx) => {
      const [spent] = await tx<{ user_id: string; expired: boolean }[]>`
        update auth_tokens set consumed_at = now()
        where id = (
          select id from auth_tokens
          where purpose = 'password_reset' and token_hash = ${hashToken(token)} and consumed_at is null
          limit 1
        )
        returning user_id, expires_at <= now() as expired
      `;
      if (!spent) {
        // Never existed, or was spent before this. One message either way: a
        // link that does not work is not worth telling a stranger why.
        const seen = await tx<{ id: string }[]>`
          select id from auth_tokens where purpose = 'password_reset' and token_hash = ${hashToken(token)} limit 1
        `;
        throw seen.length > 0
          ? new AuthError("reset_used", "That link has already been used")
          : new AuthError("reset_invalid", "That link is not valid");
      }
      if (spent.expired) throw new AuthError("reset_expired", "That link has expired");

      // `users` carries the set_updated_at trigger, so the timestamp is not ours to write.
      await tx`update users set password_hash = ${await hashPassword(password)} where id = ${spent.user_id}`;
      await tx`update sessions set revoked_at = now() where user_id = ${spent.user_id} and revoked_at is null`;
    });
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
