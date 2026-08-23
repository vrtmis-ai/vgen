import { z } from "zod";

export const GrantKindSchema = z.enum([
  "plan_monthly",
  "plan_annual_slice",
  "company",
  "signup_gift",
  "reward",
  "referral",
  "admin_adjust",
]);

/**
 * Coin amounts are no longer whole. Generations bill in hundredths of a coin
 * (MICRO_CREDITS_PER_BILLED_STEP), so a balance left after spending is a
 * fraction — requiring an integer here would reject a wallet the ledger holds
 * perfectly well. Timestamps stay integers.
 */
const CoinAmount = z.number().nonnegative();

export const CreditGrantSchema = z.object({
  id: z.string().min(1),
  kind: GrantKindSchema,
  coinsGranted: CoinAmount,
  coinsRemaining: CoinAmount,
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
});

export const WalletSchema = z.object({
  spendable: CoinAmount,
  grants: z.array(CreditGrantSchema),
  nextExpiry: z.object({ at: z.number().int().nonnegative(), coins: CoinAmount }).optional(),
});

export type Wallet = z.infer<typeof WalletSchema>;
