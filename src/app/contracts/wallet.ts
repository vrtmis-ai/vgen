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

export const CreditGrantSchema = z.object({
  id: z.string().min(1),
  kind: GrantKindSchema,
  coinsGranted: z.number().int().nonnegative(),
  coinsRemaining: z.number().int().nonnegative(),
  grantedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().optional(),
});

export const WalletSchema = z.object({
  spendable: z.number().int().nonnegative(),
  grants: z.array(CreditGrantSchema),
  nextExpiry: z.object({ at: z.number().int().nonnegative(), coins: z.number().int().nonnegative() }).optional(),
});

export type Wallet = z.infer<typeof WalletSchema>;
