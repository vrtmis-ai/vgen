import { describe, expect, it } from "vitest";
import { coinDigits, faNum } from "./format";

/**
 * Coins are billed in hundredths, so a wallet can hold 0.9 of one and the
 * cheapest models cost 0.10 or 0.16. Every case here is a number the display
 * used to get wrong, or a rounding the billing step says must not appear.
 */
describe("coinDigits", () => {
  it("prints a whole coin without decimals", () => {
    expect(coinDigits(1250)).toBe("1,250");
    expect(coinDigits(0)).toBe("0");
  });

  it("keeps a sub-coin balance rather than collapsing it", () => {
    // Rounded to an integer this reads "1" (money the account does not have)
    // or "0" (a top-up prompt for someone who can still afford five runs).
    expect(coinDigits(0.9)).toBe("0.9");
    expect(coinDigits(0.16)).toBe("0.16");
    expect(coinDigits(0.1)).toBe("0.1");
  });

  it("stops at the billing step, so float noise cannot reach the screen", () => {
    // (0.004 * 2) / 0.05 in doubles is 0.16000000000000003.
    expect(coinDigits(0.16000000000000003)).toBe("0.16");
    expect(coinDigits(1250.005)).toBe("1,250.01");
  });

  it("drops trailing zeros — whole coins are still the common case", () => {
    expect(coinDigits(1250.0)).toBe("1,250");
    expect(coinDigits(3.1)).toBe("3.1");
  });

  it("groups thousands, and survives the Persian digit pass", () => {
    expect(coinDigits(1234567.89)).toBe("1,234,567.89");
    expect(faNum(coinDigits(1250.5))).toBe("۱,۲۵۰.۵");
  });
});
