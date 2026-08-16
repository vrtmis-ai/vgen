export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type { InputMap, InputValue } from "./types";
export {
  WeakPasswordError,
  assertUsablePassword,
  generateOtpCode,
  generateSessionToken,
  hashPassword,
  hashPhone,
  hashToken,
  normalizeIranianPhone,
  openSecret,
  sealSecret,
  sealingKeyFrom,
  tokensMatch,
  verifyPassword,
} from "./secrets";
export {
  CHARACTER_BLOCK,
  isRefusal,
  matchPriceRow,
  resolvePrice,
  type PriceInputs,
  type PriceOutcome,
  type PriceRefusal,
  type PriceRowLike,
} from "./priceResolution";
export { base32Decode, base32Encode, generateTotpSecret, totpCode, totpEnrolmentUri, verifyTotp } from "./totp";
export {
  KIE_CREDIT_USD,
  COIN_USD,
  MARGIN,
  MICRO_CREDITS_PER_COIN,
  coinsFor,
  coinsForKieCredits,
  coinsToMicroCredits,
  microCreditsFor,
  microCreditsForKieCredits,
  microCreditsToCoins,
} from "./pricing";
