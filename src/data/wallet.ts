// The user's coins, as buckets rather than a number.
//
// A single balance cannot express the locked model. Coins arrive as *grants*,
// each with its own expiry: a monthly plan's grant burns at the end of that
// month, an annual plan drips a fresh grant every month of the year it paid
// for, a company plan gets one bucket lasting a year, and gifts, rewards and
// referral payouts each land as their own row on their own clock. §14 is
// explicit that one person can hold a monthly and an annual bucket at the same
// time, and that spending draws from whichever expires soonest.
//
// So this file is the client's view of `credit_ledger`, and the shape matters
// more than the code: a balance column cannot be decomposed into buckets after
// the fact — the history simply is not there. Expired-credit revenue, real
// margin and team-account separation are all queries over these rows, which is
// why the admin panel is mostly SQL provided this lands first.
//
// 🔴 WHAT THE CLIENT MUST NOT COMPUTE. All four are money decisions and all four
// belong to the server:
//   • the spendable total
//   • which bucket a spend draws from
//   • whether a grant has expired
//   • the price of a generation
// Everything here renders numbers the server sent. `demoWallet()` invents them
// only because there is no server yet, and it is the one thing in this file that
// should be deleted rather than ported.

/** Why a grant exists. Gift, reward and referral are three kinds, not three systems. */
export type GrantKind =
  | "plan_monthly"
  /** One month of an annual plan. Twelve of these, not one big grant on day one. */
  | "plan_annual_slice"
  | "company"
  | "signup_gift"
  | "reward"
  | "referral"
  /** Manual correction by an admin — always paired with an audit-log entry. */
  | "admin_adjust";

export interface CreditGrant {
  id: string;
  kind: GrantKind;
  coinsGranted: number;
  /** Server-computed. The client never decrements this itself. */
  coinsRemaining: number;
  grantedAt: number;
  /**
   * Per grant, not per plan. This is the field a global MONTHLY_EXPIRY_DAYS
   * constant cannot represent, and the reason expiry has to be data.
   */
  expiresAt: number;
}

export interface Wallet {
  /** Server-computed sum of unexpired remainders. Display only. */
  spendable: number;
  /** Sorted by `expiresAt` ascending — the order coins will actually be spent in. */
  grants: CreditGrant[];
  /** The "use it or lose it" nudge, when there is one. */
  nextExpiry?: { at: number; coins: number } | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from now until `at`; negative once it has passed. Display only. */
export function daysUntil(at: number, now = Date.now()): number {
  return Math.ceil((at - now) / DAY_MS);
}

/**
 * A stand-in wallet for a signed-in demo user, in the real shape.
 *
 * Two buckets on purpose: a plan grant and a signup gift expiring sooner, so the
 * screens are exercised against the case a single number could never show — the
 * one where the next thing to expire is not the biggest pile.
 *
 * Delete this when `GET /me` exists. It is the only place in the file that
 * computes a balance, which is exactly what the client is not allowed to do.
 */
export function demoWallet(now = Date.now()): Wallet {
  const rows: CreditGrant[] = [
    {
      id: "demo-gift",
      kind: "signup_gift",
      coinsGranted: 12,
      coinsRemaining: 12,
      grantedAt: now - 4 * DAY_MS,
      expiresAt: now + 10 * DAY_MS, // 14-day gift, 4 days in
    },
    {
      id: "demo-plan",
      kind: "plan_monthly",
      coinsGranted: 1300,
      coinsRemaining: 1238,
      grantedAt: now - 4 * DAY_MS,
      expiresAt: now + 26 * DAY_MS,
    },
  ];
  const grants = rows.sort((a, b) => a.expiresAt - b.expiresAt);

  const spendable = grants.reduce((sum, g) => sum + g.coinsRemaining, 0);
  const soonest = grants[0];
  return {
    spendable,
    grants,
    ...(soonest ? { nextExpiry: { at: soonest.expiresAt, coins: soonest.coinsRemaining } } : {}),
  };
}
