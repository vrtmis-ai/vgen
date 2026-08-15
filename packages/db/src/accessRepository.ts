import { randomBytes } from "node:crypto";
import { microCreditsToCoins } from "@vgen/core";
import type { Sql } from "postgres";

/**
 * Crockford's base32: the digits plus the letters, minus I, L, O and U.
 *
 * Chosen rather than invented because these codes get read off posters, retyped
 * from screenshots and dictated over the phone. Dropping I/L/O removes every
 * pair that is ambiguous against a digit, so 0 and 1 can stay; dropping U keeps
 * generated codes from spelling anything unfortunate.
 *
 * It is exactly 32 symbols, which is the property that matters here: five bits
 * map to one character with no remainder, so masking a random byte is unbiased.
 * An alphabet of any other size needs rejection sampling, and an alphabet of
 * fewer than 32 silently indexes past the end.
 */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Codes an operator must not be able to mint, because they read as instructions. */
const RESERVED_CODES = new Set(["admin", "deev", "test", "null", "undefined", "none", "new", "delete"]);

const CUSTOM_CODE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,62}[a-zA-Z0-9]$/;

export class InvalidCodeError extends Error {
  readonly code = "invalid_code";
  constructor(message: string) {
    super(message);
    this.name = "InvalidCodeError";
  }
}

/** A random code, e.g. `K7QMX4RD`. Case-insensitive at the column, so display it uppercase. */
export function generateCode(length = 8): string {
  if (length < 4 || length > 32) throw new InvalidCodeError("Generated code length must be between 4 and 32");
  const bytes = randomBytes(length);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte & 31];
  return code;
}

/**
 * Validates an operator-chosen code such as `apple-deev`.
 *
 * Not lowercased on the way in: the column is citext, so 'Apple-DEEV' and
 * 'apple-deev' already collide, and preserving what the operator typed keeps the
 * admin list readable.
 */
export function normalizeCustomCode(raw: string): string {
  const code = raw.trim();
  if (!CUSTOM_CODE_PATTERN.test(code)) {
    throw new InvalidCodeError("A code must be 3-64 characters of letters, digits and inner hyphens");
  }
  if (RESERVED_CODES.has(code.toLowerCase())) throw new InvalidCodeError(`"${code}" is reserved`);
  return code;
}

export type InviteKind = "campaign" | "user";

export interface CreateInviteInput {
  code?: string | undefined;
  label?: string | undefined;
  kind?: InviteKind | undefined;
  createdBy?: string | undefined;
  ownerUserId?: string | undefined;
  maxRedemptions?: number | undefined;
  grantCoins?: number | undefined;
  grantExpiresDays?: number | undefined;
  promoCodeId?: string | undefined;
  expiresAt?: Date | undefined;
  notes?: string | undefined;
}

export interface InvitePerformance {
  id: string;
  code: string;
  label: string | null;
  kind: InviteKind;
  isUsable: boolean;
  revokedAt: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  grantCoins: number;
  usersJoined: number;
  /** What everyone admitted by this code has actually spent, in coins. */
  coinsSpent: number;
  coinsRemaining: number;
  firstRedeemedAt: number | null;
  lastRedeemedAt: number | null;
  createdAt: number;
}

export interface PromoPerformance {
  id: string;
  code: string;
  label: string | null;
  kind: "credits" | "percent_off" | "amount_off" | "free_term";
  isUsable: boolean;
  revokedAt: number | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  coins: number;
  percentOff: number | null;
  amountOff: number | null;
  firstPurchaseOnly: boolean;
  redemptions: number;
  accounts: number;
  orderAmount: number;
  coinsSpent: number;
  createdAt: number;
}

export interface CreatePromoInput {
  code?: string | undefined;
  label?: string | undefined;
  kind: PromoPerformance["kind"];
  coins?: number | undefined;
  percentOff?: number | undefined;
  amountOff?: number | undefined;
  planId?: string | undefined;
  maxRedemptions?: number | undefined;
  maxPerAccount?: number | undefined;
  firstPurchaseOnly?: boolean | undefined;
  expiresAt?: Date | undefined;
  createdBy?: string | undefined;
}

const COIN = 1_000_000;
const time = (value: Date | null): number | null => (value ? value.getTime() : null);
const int = (value: string | number | null): number => Number(value ?? 0);

type InviteRow = {
  id: string;
  code: string;
  label: string | null;
  kind: InviteKind;
  is_usable: boolean;
  revoked_at: Date | null;
  max_redemptions: number | null;
  redemption_count: number;
  grant_micro_credits: string;
  users_joined: string;
  micro_credits_spent: string;
  micro_credits_remaining: string;
  first_redeemed_at: Date | null;
  last_redeemed_at: Date | null;
  created_at: Date;
};

function toInvite(row: InviteRow): InvitePerformance {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    kind: row.kind,
    isUsable: row.is_usable,
    revokedAt: time(row.revoked_at),
    maxRedemptions: row.max_redemptions,
    redemptionCount: row.redemption_count,
    grantCoins: microCreditsToCoins(int(row.grant_micro_credits)),
    usersJoined: int(row.users_joined),
    coinsSpent: microCreditsToCoins(int(row.micro_credits_spent)),
    coinsRemaining: microCreditsToCoins(int(row.micro_credits_remaining)),
    firstRedeemedAt: time(row.first_redeemed_at),
    lastRedeemedAt: time(row.last_redeemed_at),
    createdAt: row.created_at.getTime(),
  };
}

type PromoRow = {
  id: string;
  code: string;
  label: string | null;
  kind: PromoPerformance["kind"];
  is_usable: boolean;
  revoked_at: Date | null;
  max_redemptions: number | null;
  redemption_count: number;
  micro_credits: string;
  percent_off: string | null;
  amount_off: string | null;
  first_purchase_only: boolean;
  redemptions: string;
  accounts: string;
  order_amount: string;
  micro_credits_spent: string;
  created_at: Date;
};

function toPromo(row: PromoRow): PromoPerformance {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    kind: row.kind,
    isUsable: row.is_usable,
    revokedAt: time(row.revoked_at),
    maxRedemptions: row.max_redemptions,
    redemptionCount: row.redemption_count,
    coins: microCreditsToCoins(int(row.micro_credits)),
    percentOff: row.percent_off === null ? null : Number(row.percent_off),
    amountOff: row.amount_off === null ? null : Number(row.amount_off),
    firstPurchaseOnly: row.first_purchase_only,
    redemptions: int(row.redemptions),
    accounts: int(row.accounts),
    orderAmount: Number(row.order_amount ?? 0),
    coinsSpent: microCreditsToCoins(int(row.micro_credits_spent)),
    createdAt: row.created_at.getTime(),
  };
}

/**
 * Invite codes, discount codes, and the early-access gate.
 *
 * Deletion is revocation. A hard delete would orphan the redemption history,
 * which is both the campaign's result and the audit trail for an abusive
 * inviter — the two things an operator most needs after deciding a code was a
 * mistake. `deleteInvite` exists for the genuine case of a code created by
 * accident and never used, and refuses once anyone has redeemed it.
 */
export class PostgresAccessRepository {
  constructor(private readonly sql: Sql) {}

  async createInvite(input: CreateInviteInput): Promise<InvitePerformance> {
    const code = input.code ? normalizeCustomCode(input.code) : generateCode();
    const [row] = await this.sql<{ id: string }[]>`
      insert into invite_codes (
        code, label, kind, created_by, owner_user_id, max_redemptions,
        grant_micro_credits, grant_expires_days, promo_code_id, expires_at, notes
      ) values (
        ${code}, ${input.label ?? null}, ${input.kind ?? "campaign"}, ${input.createdBy ?? null},
        ${input.ownerUserId ?? null}, ${input.maxRedemptions ?? null},
        ${(input.grantCoins ?? 0) * COIN}, ${input.grantExpiresDays ?? null},
        ${input.promoCodeId ?? null}, ${input.expiresAt ?? null}, ${input.notes ?? null}
      )
      returning id
    `;
    const invite = await this.getInvite(row!.id);
    if (!invite) throw new Error("Invite insert returned no row");
    return invite;
  }

  /** Bulk generation, for handing a batch of single-use links to a channel. */
  async createInviteBatch(count: number, input: Omit<CreateInviteInput, "code">): Promise<InvitePerformance[]> {
    if (!Number.isInteger(count) || count < 1 || count > 500) {
      throw new InvalidCodeError("Batch size must be between 1 and 500");
    }
    const created: InvitePerformance[] = [];
    for (let index = 0; index < count; index += 1) created.push(await this.createInvite(input));
    return created;
  }

  async listInvites(limit = 100): Promise<InvitePerformance[]> {
    const rows = await this.sql<InviteRow[]>`
      select * from v_invite_performance order by created_at desc limit ${Math.min(Math.max(limit, 1), 500)}
    `;
    return rows.map(toInvite);
  }

  async getInvite(id: string): Promise<InvitePerformance | null> {
    const [row] = await this.sql<InviteRow[]>`select * from v_invite_performance where id = ${id}`;
    return row ? toInvite(row) : null;
  }

  async getInviteByCode(code: string): Promise<InvitePerformance | null> {
    const [row] = await this.sql<InviteRow[]>`select * from v_invite_performance where code = ${code}`;
    return row ? toInvite(row) : null;
  }

  /** Who joined through a code — the other half of "how many used it". */
  async listInviteRedeemers(id: string, limit = 200): Promise<{ userId: string; coinsSpent: number; redeemedAt: number }[]> {
    const rows = await this.sql<{ user_id: string; micro_credits_spent: string; redeemed_at: Date }[]>`
      select ir.user_id, coalesce(ab.lifetime_spent, 0)::text as micro_credits_spent, ir.redeemed_at
      from invite_redemptions ir
      left join account_balances ab on ab.account_id = ir.account_id
      where ir.invite_code_id = ${id}
      order by ir.redeemed_at desc
      limit ${Math.min(Math.max(limit, 1), 1000)}
    `;
    return rows.map((row) => ({
      userId: row.user_id,
      coinsSpent: microCreditsToCoins(int(row.micro_credits_spent)),
      redeemedAt: row.redeemed_at.getTime(),
    }));
  }

  async revokeInvite(id: string, revokedBy: string | null): Promise<InvitePerformance | null> {
    await this.sql`
      update invite_codes
      set is_active = false, revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, ${revokedBy})
      where id = ${id}
    `;
    return this.getInvite(id);
  }

  /** Only for a code nobody used. Anything else must be revoked, so the history survives. */
  async deleteInvite(id: string): Promise<"deleted" | "has_redemptions" | "not_found"> {
    const rows = await this.sql<{ id: string }[]>`
      delete from invite_codes
      where id = ${id} and not exists (select 1 from invite_redemptions where invite_code_id = ${id})
      returning id
    `;
    if (rows.length > 0) return "deleted";
    const [existing] = await this.sql<{ id: string }[]>`select id from invite_codes where id = ${id}`;
    return existing ? "has_redemptions" : "not_found";
  }

  /**
   * Admits an account. Everything that makes this correct — the cap under
   * concurrency, the credit grant, the referral row — is in redeem_invite();
   * this is the call, not a second implementation of it.
   */
  async redeemInvite(code: string, userId: string, accountId: string, ip?: string): Promise<string> {
    const [row] = await this.sql<{ redeem_invite: string }[]>`
      select redeem_invite(${code}, ${userId}, ${accountId}, ${ip ?? null}) as redeem_invite
    `;
    return row!.redeem_invite;
  }

  async createPromo(input: CreatePromoInput): Promise<PromoPerformance> {
    const code = input.code ? normalizeCustomCode(input.code) : generateCode();
    const [row] = await this.sql<{ id: string }[]>`
      insert into promo_codes (
        code, label, kind, micro_credits, percent_off, amount_off, plan_id,
        max_redemptions, max_per_account, first_purchase_only, expires_at, created_by
      ) values (
        ${code}, ${input.label ?? null}, ${input.kind}, ${(input.coins ?? 0) * COIN},
        ${input.percentOff ?? null}, ${input.amountOff ?? null}, ${input.planId ?? null},
        ${input.maxRedemptions ?? null}, ${input.maxPerAccount ?? 1},
        ${input.firstPurchaseOnly ?? false}, ${input.expiresAt ?? null}, ${input.createdBy ?? null}
      )
      returning id
    `;
    const promo = await this.getPromo(row!.id);
    if (!promo) throw new Error("Promo insert returned no row");
    return promo;
  }

  async listPromos(limit = 100): Promise<PromoPerformance[]> {
    const rows = await this.sql<PromoRow[]>`
      select * from v_promo_performance order by created_at desc limit ${Math.min(Math.max(limit, 1), 500)}
    `;
    return rows.map(toPromo);
  }

  async getPromo(id: string): Promise<PromoPerformance | null> {
    const [row] = await this.sql<PromoRow[]>`select * from v_promo_performance where id = ${id}`;
    return row ? toPromo(row) : null;
  }

  async revokePromo(id: string, revokedBy: string | null): Promise<PromoPerformance | null> {
    await this.sql`
      update promo_codes
      set is_active = false, revoked_at = coalesce(revoked_at, now()), revoked_by = coalesce(revoked_by, ${revokedBy})
      where id = ${id}
    `;
    return this.getPromo(id);
  }

  async deletePromo(id: string): Promise<"deleted" | "has_redemptions" | "not_found"> {
    const rows = await this.sql<{ id: string }[]>`
      delete from promo_codes
      where id = ${id} and not exists (select 1 from promo_redemptions where promo_code_id = ${id})
      returning id
    `;
    if (rows.length > 0) return "deleted";
    const [existing] = await this.sql<{ id: string }[]>`select id from promo_codes where id = ${id}`;
    return existing ? "has_redemptions" : "not_found";
  }

  /** Is the invite gate up? Read on every signup. */
  async isEarlyAccess(): Promise<boolean> {
    const [row] = await this.sql<{ is_enabled: boolean }[]>`
      select is_enabled from feature_flags where code = 'early_access'
    `;
    // Absent means the flag was deleted, which should fail closed: an invite
    // gate that disappears silently is an open signup page.
    return row?.is_enabled ?? true;
  }

  async setEarlyAccess(enabled: boolean, updatedBy: string | null): Promise<boolean> {
    const [row] = await this.sql<{ is_enabled: boolean }[]>`
      insert into feature_flags (code, description, is_enabled, rules, updated_by)
      values ('early_access', 'Signup requires a valid invite code while this is enabled.', ${enabled},
              ${this.sql.json({ invite_required: enabled })}, ${updatedBy})
      on conflict (code) do update
        set is_enabled = excluded.is_enabled, rules = excluded.rules,
            updated_by = excluded.updated_by, updated_at = now()
      returning is_enabled
    `;
    return row!.is_enabled;
  }
}
