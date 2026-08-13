import type { CustomerSessionUser } from "@vgen/contracts";
import type { Sql } from "postgres";

export const SIGNUP_GIFT_COINS = 12;
export const SIGNUP_GIFT_TTL_DAYS = 14;

export class CustomerIdentityConflictError extends Error {
  readonly code = "customer_identity_conflict";

  constructor() {
    super("Verified email belongs to another DEEV account");
    this.name = "CustomerIdentityConflictError";
  }
}

export interface ClerkCustomerProfile {
  clerkUserId: string;
  emailNormalized: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface CustomerRepository {
  syncClerkUser(profile: ClerkCustomerProfile): Promise<CustomerSessionUser>;
}

export class PostgresCustomerRepository implements CustomerRepository {
  constructor(private readonly sql: Sql) {}

  async syncClerkUser(profile: ClerkCustomerProfile): Promise<CustomerSessionUser> {
    const result = await this.sql.begin(async (transaction) => {
      const lockKeys = [`clerk:${profile.clerkUserId}`, `email:${profile.emailNormalized}`].sort();
      for (const key of lockKeys) await transaction`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`;

      const [existing] = await transaction<
        { id: string; display_name: string | null; avatar_url: string | null; locale: "fa" | "en"; is_team: boolean }[]
      >`
        select u.id, u.display_name, u.avatar_url, u.locale, u.is_team
        from identities i
        join users u on u.id = i.user_id
        where i.provider = 'clerk' and i.subject = ${profile.clerkUserId} and u.status = 'active'
        limit 1
      `;

      let user = existing;
      if (!user) {
        [user] = await transaction<
          { id: string; display_name: string | null; avatar_url: string | null; locale: "fa" | "en"; is_team: boolean }[]
        >`
          insert into users (display_name, avatar_url)
          values (${profile.displayName}, ${profile.avatarUrl})
          returning id, display_name, avatar_url, locale, is_team
        `;
        if (!user) throw new Error("User insert returned no row");
        await transaction`
          insert into identities (user_id, provider, subject, verified_at)
          values (${user.id}, 'clerk', ${profile.clerkUserId}, now())
        `;
      } else {
        const [updated] = await transaction<
          { id: string; display_name: string | null; avatar_url: string | null; locale: "fa" | "en"; is_team: boolean }[]
        >`
          update users
          set display_name = ${profile.displayName}, avatar_url = ${profile.avatarUrl}
          where id = ${user.id}
          returning id, display_name, avatar_url, locale, is_team
        `;
        if (updated) user = updated;
      }

      const [emailOwner] = await transaction<{ user_id: string }[]>`
        select user_id from identities where provider = 'email' and subject = ${profile.emailNormalized} limit 1
      `;
      if (emailOwner && emailOwner.user_id !== user.id) throw new CustomerIdentityConflictError();
      if (!emailOwner) {
        await transaction`
          insert into identities (user_id, provider, subject, verified_at)
          values (${user.id}, 'email', ${profile.emailNormalized}, now())
        `;
      }

      const [existingSignupGift] = await transaction<{ id: string }[]>`
        select id from credit_ledger where user_id = ${user.id} and idempotency_key = 'signup_gift:v1' limit 1
      `;
      if (!existingSignupGift) {
        const [signupGift] = await transaction<{ id: string }[]>`
          insert into credit_grants (user_id, kind, amount, granted_at, expires_at, note)
          values (
            ${user.id},
            'signup_gift',
            ${SIGNUP_GIFT_COINS},
            now(),
            now() + (${SIGNUP_GIFT_TTL_DAYS} * interval '1 day'),
            'DEEV signup gift'
          )
          returning id
        `;
        if (!signupGift) throw new Error("Signup gift insert returned no row");
        await transaction`
          insert into credit_ledger (user_id, grant_id, delta, reason, idempotency_key)
          values (${user.id}, ${signupGift.id}, ${SIGNUP_GIFT_COINS}, 'grant_signup_gift', 'signup_gift:v1')
        `;
      }

      return {
        id: user.id,
        methods: ["email"] as ["email"],
        emailNormalized: profile.emailNormalized,
        ...(user.display_name ? { displayName: user.display_name } : {}),
        ...(user.avatar_url ? { avatarUrl: user.avatar_url } : {}),
        locale: user.locale,
        isTeam: user.is_team,
      };
    });
    return result as CustomerSessionUser;
  }
}
