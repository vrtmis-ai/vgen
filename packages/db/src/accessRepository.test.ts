import { describe, expect, it } from "vitest";
import { InvalidCodeError, generateCode, normalizeCustomCode } from "./accessRepository";

describe("generated invite codes", () => {
  it("only ever emits characters from the alphabet", () => {
    // The bug this catches: an alphabet of any size other than 32 makes
    // `byte & 31` index past the end, and the code silently contains
    // "undefined". 500 codes is ~4000 characters, enough to hit every index.
    const alphabet = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/;
    for (let i = 0; i < 500; i += 1) {
      expect(generateCode()).toMatch(alphabet);
    }
  });

  it("leaves out the characters people mistype", () => {
    // I/L confuse with 1, O confuses with 0, U is dropped to avoid accidental
    // words. A code that cannot be read off a poster is a campaign that
    // underperforms for no visible reason.
    const codes = Array.from({ length: 300 }, () => generateCode(16)).join("");
    expect(codes).not.toMatch(/[ILOU]/);
  });

  it("honours the requested length and refuses silly ones", () => {
    expect(generateCode(4)).toHaveLength(4);
    expect(generateCode(32)).toHaveLength(32);
    expect(() => generateCode(3)).toThrow(InvalidCodeError);
    expect(() => generateCode(33)).toThrow(InvalidCodeError);
  });

  it("does not repeat itself", () => {
    const codes = new Set(Array.from({ length: 1000 }, () => generateCode()));
    expect(codes.size).toBe(1000);
  });
});

describe("operator-chosen codes", () => {
  it("accepts the campaign names an operator would actually type", () => {
    expect(normalizeCustomCode("apple-deev")).toBe("apple-deev");
    expect(normalizeCustomCode("  NOWRUZ1405  ")).toBe("NOWRUZ1405");
    expect(normalizeCustomCode("a1b")).toBe("a1b");
  });

  it("keeps the operator's capitalisation", () => {
    // The column is citext, so 'Apple-DEEV' and 'apple-deev' already collide.
    // Lowercasing would only make the admin list harder to read.
    expect(normalizeCustomCode("Apple-DEEV")).toBe("Apple-DEEV");
  });

  it("rejects codes that break a URL or read as something else", () => {
    expect(() => normalizeCustomCode("")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("ab")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("-leading")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("trailing-")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("has space")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("has/slash")).toThrow(InvalidCodeError);
    expect(() => normalizeCustomCode("a".repeat(65))).toThrow(InvalidCodeError);
  });

  it("refuses reserved words, case-insensitively", () => {
    expect(() => normalizeCustomCode("admin")).toThrow(/reserved/);
    expect(() => normalizeCustomCode("ADMIN")).toThrow(/reserved/);
    expect(() => normalizeCustomCode("Delete")).toThrow(/reserved/);
  });
});
