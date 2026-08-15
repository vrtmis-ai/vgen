import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238), the second factor for staff accounts.
 *
 * Written out rather than pulled in: it is an HMAC, a big-endian counter and a
 * truncation, all of which Node already has. A dependency here would be more
 * lines of lockfile than of algorithm.
 */
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** RFC 4648 base32 — what authenticator apps expect, and unrelated to the Crockford variant used for invite codes. */
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes));
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(secret: string): Buffer {
  const clean = secret.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32.indexOf(character);
    if (index === -1) throw new Error("Invalid base32 in TOTP secret");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The code an authenticator app would be showing at `atMs`. */
export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / PERIOD_SECONDS);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac("sha1", base32Decode(secret)).update(counterBytes).digest();
  // Dynamic truncation, RFC 4226 §5.3: the low nibble of the last byte picks
  // where to read four bytes from, and the top bit is masked so the result is
  // positive on platforms that read it as signed.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) | ((digest[offset + 1]! & 0xff) << 16) | ((digest[offset + 2]! & 0xff) << 8) | (digest[offset + 3]! & 0xff);
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

/**
 * Verifies a code, allowing one step either side.
 *
 * The window exists because phones drift and people type slowly; one step is
 * the usual compromise — it accepts a code for at most 90 seconds rather than
 * widening the guessing surface further.
 */
export function verifyTotp(secret: string, code: string, atMs = Date.now()): boolean {
  const candidate = code.trim();
  if (!/^\d{6}$/.test(candidate)) return false;
  for (const step of [-1, 0, 1]) {
    const expected = totpCode(secret, atMs + step * PERIOD_SECONDS * 1000);
    // Constant-time, so a near-miss cannot be distinguished by timing.
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(candidate))) return true;
  }
  return false;
}

/** The `otpauth://` URI an authenticator app scans. */
export function totpEnrolmentUri(secret: string, accountLabel: string, issuer = "DEEV"): string {
  const label = encodeURIComponent(`${issuer}:${accountLabel}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(DIGITS), period: String(PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
