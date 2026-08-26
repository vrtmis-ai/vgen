import type { AppServices } from "../../runtime/AppServices";
import type { CreditGrantSchema, Wallet } from "../../runtime/contracts/wallet";
import type { z } from "zod";

type CreditGrant = z.infer<typeof CreditGrantSchema>;
const DAY_MS = 24 * 60 * 60 * 1000;

export function demoWallet(now: number): Wallet {
  /**
   * Two buckets that add up to a story, rather than two round numbers.
   *
   * The plan grant is Pro's own `coinsPerTerm` from the served ladder — 1100
   * over 30 days — so the figure a developer sees here is one the shop can
   * actually issue. The reward brings the total to 1250, and the pair is spent
   * down to 520 so the balance reads as a *remainder*: a wallet sitting at 95%
   * makes the ring in the bar look full and tests nothing.
   *
   * Spending draws from whichever expires soonest, which is why the reward is
   * the emptier of the two.
   */
  const rows: CreditGrant[] = [
    {
      id: "demo-reward",
      kind: "reward",
      coinsGranted: 150,
      coinsRemaining: 50,
      grantedAt: now - 4 * DAY_MS,
      expiresAt: now + 10 * DAY_MS,
    },
    {
      id: "demo-plan",
      kind: "plan_monthly",
      coinsGranted: 1100,
      coinsRemaining: 470,
      grantedAt: now - 4 * DAY_MS,
      expiresAt: now + 26 * DAY_MS,
    },
  ];
  const grants = rows.sort((a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY));
  const soonest = grants.find((grant) => grant.expiresAt != null);

  return {
    spendable: grants.reduce((sum, grant) => sum + grant.coinsRemaining, 0),
    grants,
    ...(soonest?.expiresAt != null ? { nextExpiry: { at: soonest.expiresAt, coins: soonest.coinsRemaining } } : {}),
  };
}

export function createDemoWalletService(now: () => number): AppServices["wallet"] {
  return { getCurrent: async () => demoWallet(now()) };
}
