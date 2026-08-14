import type { AppServices } from "../../runtime/AppServices";
import type { CreditGrantSchema, Wallet } from "../../runtime/contracts/wallet";
import type { z } from "zod";

type CreditGrant = z.infer<typeof CreditGrantSchema>;
const DAY_MS = 24 * 60 * 60 * 1000;

export function demoWallet(now: number): Wallet {
  const rows: CreditGrant[] = [
    {
      id: "demo-gift",
      kind: "signup_gift",
      coinsGranted: 12,
      coinsRemaining: 12,
      grantedAt: now - 4 * DAY_MS,
      expiresAt: now + 10 * DAY_MS,
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
