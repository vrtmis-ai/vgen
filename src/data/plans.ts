// Coin (سکه) packages for the buy screen.
//
// Pricing note: 1 coin = $0.05 of value. Iranian users pay in Toman via ZarinPal,
// so the displayed price = coins * TOMAN_PER_COIN. The exchange rate moves, so this
// is ONE constant to set — do not hardcode prices per pack.
// TODO(owner): set the real Toman rate. (placeholder below)

export const TOMAN_PER_COIN = 3500; // placeholder — owner to confirm

export interface CoinPack {
  id: string;
  coins: number;
  bonus: number; // extra coins gifted
  tag?: string; // small label (popular / best value / gift)
  popular?: boolean;
}

export const PACKS: CoinPack[] = [
  { id: "p150", coins: 150, bonus: 0 },
  { id: "p500", coins: 500, bonus: 25, tag: "۵٪ هدیه" },
  { id: "p1000", coins: 1000, bonus: 100, tag: "پرطرفدار", popular: true },
  { id: "p3000", coins: 3000, bonus: 450, tag: "بهترین ارزش" },
];

export function tomanPrice(coins: number): number {
  return coins * TOMAN_PER_COIN;
}
