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

type GrantRow = {
  id: string;
  kind: "plan" | "signup_gift" | "reward" | "referral" | "admin" | "compensation";
  amount: string;
  consumed: string;
  granted_at: Date;
  expires_at: Date | null;
};

function publicKind(kind: GrantRow["kind"]): CustomerGrantKind {
  if (kind === "plan") return "plan_monthly";
  if (kind === "admin" || kind === "compensation") return "admin_adjust";
  return kind;
}

function safeCredits(value: string): number {
  const credits = Number(value);
  if (!Number.isSafeInteger(credits) || credits < 0) throw new Error("Wallet credit amount is outside the safe integer range");
  return credits;
}

export class PostgresWalletRepository implements CustomerWalletRepository {
  constructor(private readonly sql: Sql) {}

  async getCurrent(userId: string): Promise<CustomerWallet> {
    const rows = await this.sql<GrantRow[]>`
      select id, kind, amount, consumed, granted_at, expires_at
      from credit_grants
      where user_id = ${userId}
        and consumed < amount
        and (expires_at is null or expires_at > now())
      order by expires_at asc nulls last, granted_at asc, id asc
    `;
    const grants = rows.map((row): CustomerCreditGrant => {
      const coinsGranted = safeCredits(row.amount);
      const coinsRemaining = coinsGranted - safeCredits(row.consumed);
      return {
        id: row.id,
        kind: publicKind(row.kind),
        coinsGranted,
        coinsRemaining,
        grantedAt: row.granted_at.getTime(),
        ...(row.expires_at ? { expiresAt: row.expires_at.getTime() } : {}),
      };
    });
    const nextExpiring = grants.find((grant) => grant.expiresAt != null);
    return {
      spendable: grants.reduce((total, grant) => total + grant.coinsRemaining, 0),
      grants,
      ...(nextExpiring?.expiresAt != null ? { nextExpiry: { at: nextExpiring.expiresAt, coins: nextExpiring.coinsRemaining } } : {}),
    };
  }
}
