import { microCreditsToCoins } from "@vgen/core";
import type { Sql } from "postgres";

export type CustomerGrantKind = "plan_monthly" | "plan_annual_slice" | "company" | "signup_gift" | "reward" | "referral" | "admin_adjust";

export interface CustomerCreditGrant {
  id: string;
  kind: CustomerGrantKind;
  coinsGranted: number;
  coinsRemaining: number;
  grantedAt: number;
  expiresAt?: number;
}

export interface CustomerWallet {
  spendable: number;
  grants: CustomerCreditGrant[];
  nextExpiry?: { at: number; coins: number };
}

export interface CustomerWalletRepository {
  getCurrent(userId: string): Promise<CustomerWallet>;
}

/** credit_lots.source — the schema's CHECK list, not the customer-facing names. */
type LotSource = "purchase" | "signup_bonus" | "promo" | "admin_grant" | "refund" | "referral";

type LotRow = {
  id: string;
  source: LotSource;
  micro_credits_total: string;
  micro_credits_remaining: string;
  created_at: Date;
  expires_at: Date | null;
};

function publicKind(source: LotSource): CustomerGrantKind {
  if (source === "purchase") return "plan_monthly";
  if (source === "signup_bonus") return "signup_gift";
  if (source === "promo") return "reward";
  // A refund reads as an adjustment rather than as a purchase: it is credit the
  // customer did not buy in this transaction, and calling it a plan grant would
  // imply entitlements it does not carry.
  if (source === "admin_grant" || source === "refund") return "admin_adjust";
  return "referral";
}

/**
 * bigint columns arrive as strings from postgres.js. Number() on a value past
 * 2^53 loses precision silently, and this is the money path, so the range is
 * checked rather than assumed.
 */
function safeMicroCredits(value: string): number {
  const microCredits = Number(value);
  if (!Number.isSafeInteger(microCredits) || microCredits < 0) {
    throw new Error("Wallet micro-credit amount is outside the safe integer range");
  }
  return microCredits;
}

export class PostgresWalletRepository implements CustomerWalletRepository {
  constructor(private readonly sql: Sql) {}

  async getCurrent(userId: string): Promise<CustomerWallet> {
    /* Read from credit_lots, not from the account_balances cache. The wallet
       screen needs per-lot expiry as well as a total, and deriving both from the
       same rows means the number shown and the dates shown cannot disagree —
       account_balances is explicitly a cache, reconciled nightly.

       Ordered soonest-expiring first, which is also the order credits are spent
       in, so "next to expire" is genuinely the next thing to be burned. */
    const rows = await this.sql<LotRow[]>`
      select l.id, l.source, l.micro_credits_total, l.micro_credits_remaining, l.created_at, l.expires_at
      from credit_lots l
      join users u on u.personal_account_id = l.account_id
      where u.id = ${userId}
        and l.micro_credits_remaining > 0
        and (l.expires_at is null or l.expires_at > now())
      order by l.expires_at asc nulls last, l.created_at asc, l.id asc
    `;

    let remainingMicroCredits = 0;
    const grants = rows.map((row): CustomerCreditGrant => {
      const microCreditsRemaining = safeMicroCredits(row.micro_credits_remaining);
      remainingMicroCredits += microCreditsRemaining;
      return {
        id: row.id,
        kind: publicKind(row.source),
        coinsGranted: microCreditsToCoins(safeMicroCredits(row.micro_credits_total)),
        coinsRemaining: microCreditsToCoins(microCreditsRemaining),
        grantedAt: row.created_at.getTime(),
        ...(row.expires_at ? { expiresAt: row.expires_at.getTime() } : {}),
      };
    });

    // Summed in micro-credits and converted once. Converting per lot and adding
    // the coins would drop up to a coin per lot to rounding, so a wallet of many
    // small grants would under-report a balance the customer can actually spend.
    if (!Number.isSafeInteger(remainingMicroCredits)) {
      throw new Error("Wallet total is outside the safe integer range");
    }
    const spendable = microCreditsToCoins(remainingMicroCredits);

    const nextExpiring = grants.find((grant) => grant.expiresAt != null);
    return {
      spendable,
      grants,
      ...(nextExpiring?.expiresAt != null ? { nextExpiry: { at: nextExpiring.expiresAt, coins: nextExpiring.coinsRemaining } } : {}),
    };
  }
}
