import { describe, expect, it } from "vitest";
import {
  WeakPasswordError,
  generateOtpCode,
  generateSessionToken,
  hashPassword,
  hashPhone,
  hashToken,
  normalizeIranianPhone,
  tokensMatch,
  verifyPassword,
} from "./secrets";

describe("passwords", () => {
  it("accepts the password it just hashed and nothing else", async () => {
    const stored = await hashPassword("correct horse battery");
    await expect(verifyPassword("correct horse battery", stored)).resolves.toBe(true);
    await expect(verifyPassword("correct horse batterz", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("salts, so the same password never stores the same string", async () => {
    const [first, second] = await Promise.all([hashPassword("the same password"), hashPassword("the same password")]);
    expect(first).not.toBe(second);
    await expect(verifyPassword("the same password", first)).resolves.toBe(true);
    await expect(verifyPassword("the same password", second)).resolves.toBe(true);
  });

  it("records its parameters, so the cost can be raised later", async () => {
    const stored = await hashPassword("a long enough password");
    expect(stored.startsWith("scrypt$32768$8$1$")).toBe(true);
    expect(stored.split("$")).toHaveLength(6);
  });

  it("treats a password as the characters the user sees", async () => {
    // Composed and decomposed forms of é look identical and arrive from
    // different keyboards. Without normalisation one of them cannot log in.
    const stored = await hashPassword("café password");
    await expect(verifyPassword("café password", stored)).resolves.toBe(true);
  });

  it("refuses a password too short to be worth hashing", async () => {
    await expect(hashPassword("short")).rejects.toThrow(WeakPasswordError);
    await expect(hashPassword("a".repeat(513))).rejects.toThrow(WeakPasswordError);
  });

  it("returns false rather than throwing on a corrupt stored hash", async () => {
    // A malformed row must not turn a login into a 500.
    await expect(verifyPassword("anything", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("anything", "scrypt$x$8$1$AAAA$AAAA")).resolves.toBe(false);
    await expect(verifyPassword("anything", "")).resolves.toBe(false);
  });
});

describe("session tokens", () => {
  it("never repeats and never stores the token itself", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));
    expect(tokens.size).toBe(1000);

    const token = generateSessionToken();
    const stored = hashToken(token);
    expect(stored).not.toContain(token);
    expect(tokensMatch(token, stored)).toBe(true);
    expect(tokensMatch(generateSessionToken(), stored)).toBe(false);
  });

  it("compares safely against a wrong-length hash", () => {
    expect(tokensMatch("anything", "short")).toBe(false);
  });
});

describe("one-time codes", () => {
  it("is always six digits, including when it starts with zeros", () => {
    for (let i = 0; i < 2000; i += 1) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it("covers the whole range rather than skipping the low codes", () => {
    // Generating in [100000, 999999] would make a leading zero impossible and
    // quietly shrink the space by 10%.
    const codes = Array.from({ length: 5000 }, () => generateOtpCode());
    expect(codes.some((code) => code.startsWith("0"))).toBe(true);
  });
});

describe("phone numbers", () => {
  it("treats every way an Iranian number is written as one number", () => {
    const expected = "+989121234567";
    for (const input of [
      "09121234567",
      "+989121234567",
      "989121234567",
      "9121234567",
      "0912 123 4567",
      "0912-123-4567",
      "۰۹۱۲۱۲۳۴۵۶۷",
    ]) {
      expect(normalizeIranianPhone(input)).toBe(expected);
    }
  });

  it("rejects anything that is not an Iranian mobile number", () => {
    expect(normalizeIranianPhone("02112345678")).toBeNull(); // landline
    expect(normalizeIranianPhone("+15551234567")).toBeNull(); // not Iran
    expect(normalizeIranianPhone("0912123456")).toBeNull(); // too short
    expect(normalizeIranianPhone("not a phone")).toBeNull();
    expect(normalizeIranianPhone("")).toBeNull();
  });

  it("hashes with a pepper, so the trial record is not an enumerable list", () => {
    const phone = "+989121234567";
    expect(hashPhone(phone, "pepper-a")).not.toBe(hashPhone(phone, "pepper-b"));
    expect(hashPhone(phone, "pepper-a")).toBe(hashPhone(phone, "pepper-a"));
    expect(hashPhone(phone, "pepper-a")).not.toContain("9121234567");
  });
});
