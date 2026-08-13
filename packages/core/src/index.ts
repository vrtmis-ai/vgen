export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export type { InputMap, InputValue, PriceCtx, RateFn } from "./types";
export { KIE_CREDIT_USD, COIN_USD, MARGIN, NO_CTX, coinsFor, coinsForKieCredits, perKChars, pick, RATES_FALLBACK } from "./pricing";
