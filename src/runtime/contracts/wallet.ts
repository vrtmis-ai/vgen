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
  /**
   * What this account may run, as the server decides it.
   *
   * The padlocks used to be drawn from the price list: the browser matched a
   * plan code against `GET /plans` and read anything it could not find as tier
   * 1. An account whose plan is granted rather than sold — or simply no longer
   * on sale — was locked out of models the server would have run for it. The
   * tier the quote endpoint enforces is the only one worth drawing.
   *
   * Defaulted rather than required so a cached response from before this
   * existed parses as the tier every account starts on.
   */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
});

export type Wallet = z.infer<typeof WalletSchema>;
