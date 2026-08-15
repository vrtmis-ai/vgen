export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type { InputMap, InputValue, PriceCtx, RateFn } from "./types";
export {
  WeakPasswordError,
  assertUsablePassword,
  generateOtpCode,
  generateSessionToken,
  hashPassword,
  hashPhone,
  hashToken,
  normalizeIranianPhone,
  tokensMatch,
  verifyPassword,
} from "./secrets";
export {
  KIE_CREDIT_USD,
  COIN_USD,
  MARGIN,
  MICRO_CREDITS_PER_COIN,
  NO_CTX,
  coinsFor,
  coinsForKieCredits,
  coinsToMicroCredits,
  microCreditsFor,
  microCreditsForKieCredits,
  microCreditsToCoins,
  perKChars,
  pick,
  RATES_FALLBACK,
} from "./pricing";
