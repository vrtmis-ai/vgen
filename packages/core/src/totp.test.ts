import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, generateTotpSecret, totpCode, totpEnrolmentUri, verifyTotp } from "./totp";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const bytes of [[0], [255], [0, 1, 2, 3, 4], Array.from({ length: 20 }, (_, i) => i * 7)]) {
      const buffer = Buffer.from(bytes);
      expect(base32Decode(base32Encode(buffer))).toEqual(buffer);
    }
  });

  it("uses the RFC 4648 alphabet an authenticator app expects", () => {
    // Not the Crockford variant used for invite codes: that one drops I/L/O/U
    // and keeps 0/1, so a secret encoded with it is unreadable to every app.
    // The known-answer below is the standard's own, and would fail under it.
    expect(base32Encode(Buffer.from("Hello!", "utf8"))).toBe("JBSWY3DPEE");
    expect(base32Encode(Buffer.from([0, 0, 0, 0, 0]))).toBe("AAAAAAAA");
    expect(base32Encode(Buffer.from([255, 255, 255, 255, 255]))).toBe("77777777");
  });

  it("rejects characters that are not base32", () => {
    expect(() => base32Decode("ABC!DEF")).toThrow();
  });
});

describe("TOTP", () => {
  // RFC 6238 test vector: the ASCII secret "12345678901234567890", SHA-1.
  const rfcSecret = base32Encode(Buffer.from("12345678901234567890", "utf8"));

  it("matches the RFC 6238 reference values", () => {
    // The published vectors are 8 digits; these are their last six.
    expect(totpCode(rfcSecret, 59_000)).toBe("287082"); // 94287082
    expect(totpCode(rfcSecret, 1_111_111_109_000)).toBe("081804"); // 07081804
    expect(totpCode(rfcSecret, 1_111_111_111_000)).toBe("050471"); // 14050471
    expect(totpCode(rfcSecret, 1_234_567_890_000)).toBe("005924"); // 89005924
    expect(totpCode(rfcSecret, 2_000_000_000_000)).toBe("279037"); // 69279037
  });

  it("holds the same code for a whole 30-second step and then changes", () => {
    const at = 1_700_000_000_000;
    const step = Math.floor(at / 30_000) * 30_000;
    expect(totpCode(rfcSecret, step)).toBe(totpCode(rfcSecret, step + 29_000));
    expect(totpCode(rfcSecret, step)).not.toBe(totpCode(rfcSecret, step + 30_000));
  });

  it("accepts the current code and one step either side", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;

    expect(verifyTotp(secret, totpCode(secret, at), at)).toBe(true);
    // A phone whose clock drifts by half a minute still works.
    expect(verifyTotp(secret, totpCode(secret, at - 30_000), at)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, at + 30_000), at)).toBe(true);
  });

  it("refuses a code from further away than the window", () => {
    const secret = generateTotpSecret();
    const at = 1_700_000_000_000;

    expect(verifyTotp(secret, totpCode(secret, at - 90_000), at)).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, at + 90_000), at)).toBe(false);
  });

  it("refuses another secret's code", () => {
    const at = 1_700_000_000_000;
    expect(verifyTotp(generateTotpSecret(), totpCode(generateTotpSecret(), at), at)).toBe(false);
  });

  it("refuses anything that is not six digits, without throwing", () => {
    const secret = generateTotpSecret();
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 56", "  "]) {
      expect(verifyTotp(secret, bad)).toBe(false);
    }
  });

  it("issues secrets that differ", () => {
    expect(new Set(Array.from({ length: 200 }, () => generateTotpSecret())).size).toBe(200);
  });
});

describe("enrolment", () => {
  it("builds a scannable otpauth URI", () => {
    const uri = totpEnrolmentUri("JBSWY3DPEHPK3PXP", "admin@deev.test");

    expect(uri.startsWith("otpauth://totp/DEEV%3Aadmin%40deev.test?")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=DEEV");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
  });
});
