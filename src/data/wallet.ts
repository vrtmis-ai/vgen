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
// Everything here renders numbers the server sent. Demo values live only under
// adapters/demo so production modules cannot silently invent a balance.

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
  expiresAt?: number | undefined;
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
