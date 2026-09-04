import type { Wallet } from "../data/wallet";

/**
 * How much this wallet was granted, across the buckets it currently holds.
 *
 * **This is a display aggregate, not a money decision.** `src/data/wallet.ts`
 * lists the four things a client must never compute — the spendable total,
 * which bucket a spend draws from, whether a grant has expired, and the price of
 * a generation — and a sum of `coinsGranted` over rows the server already sent
 * is none of them. The spendable figure still comes from `wallet.spendable`,
 * untouched; this only says what those same buckets started at, so "1,250 left"
 * can say what it is left *of*.
 *
 * Expired grants leaving the array is the reason this is deliberately "what you
 * currently hold" rather than "what you have ever been given": the second
 * question needs history the wallet payload does not carry, and inventing an
 * answer from what it does carry would make the denominator shrink every time a
 * bucket lapsed.
 */
export function grantedTotal(wallet: Wallet): number {
  return wallet.grants.reduce((sum, grant) => sum + grant.coinsGranted, 0);
}

/**
 * What fraction of the granted coins is still spendable, 0–1.
 *
 * **Null when there is nothing to be a fraction of.** A wallet with no grants is
 * a real state — the e2e fixture is exactly that, and so is an account whose
 * buckets have all lapsed — and `spendable / 0` is `Infinity` or `NaN`, either
 * of which would paint a ring claiming something. Callers draw no ring for null
 * rather than a full one, because "all of nothing" is not "all".
 *
 * Clamped, because the two figures come from different places: `spendable` is
 * the server's own number and the total is summed here, so a rounding
 * disagreement must not produce a ring past its own end.
 */
export function remainingRatio(wallet: Wallet): number | null {
  const total = grantedTotal(wallet);
  if (total <= 0) return null;
  return Math.min(1, Math.max(0, wallet.spendable / total));
}
