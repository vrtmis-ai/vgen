import { createHash, randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from "node:crypto";

/**
 * promisify() only picks up scrypt's three-argument overload, and the cost
 * parameters live in the fourth. Wrapped by hand so they can be passed.
 */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => (error ? reject(error) : resolve(derived)));
  });
}

/**
 * Password hashing, token hashing and OTP generation.
 *
 * scrypt rather than argon2 or bcrypt because Node ships it: it is a
 * memory-hard KDF designed for exactly this, and a dependency that has to be
 * compiled per platform is a liability on a deploy target we control less than
 * we would like. The parameters below are the cost, and they are recorded in
 * the stored string so they can be raised later without invalidating anyone's
 * password.
 *
 * N = 2^15 puts a single hash at roughly 100ms and 32MB, which is the usual
 * trade: slow enough that an offline attacker gets little value from a stolen
 * table, fast enough that a login does not feel broken.
 */
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_SALT_BYTES = 16;
// 128 * N * r, plus headroom. Node's 32MB default is below what N=2^15 needs.
const SCRYPT_MAXMEM = 128 * SCRYPT_N * SCRYPT_R * 2;

export class WeakPasswordError extends Error {
  readonly code = "weak_password";
  constructor(message: string) {
    super(message);
    this.name = "WeakPasswordError";
  }
}

/**
 * Minimum viable password policy: length, and nothing else.
 *
 * Composition rules (a digit, a symbol, a capital) measurably push people
 * toward `Password1!` and are not applied here. Length is the property that
 * actually costs an attacker something.
 */
export function assertUsablePassword(password: string): void {
  if (password.length < 10) throw new WeakPasswordError("A password must be at least 10 characters");
  if (password.length > 512) throw new WeakPasswordError("A password must be at most 512 characters");
}

export async function hashPassword(password: string): Promise<string> {
  assertUsablePassword(password);
  const salt = randomBytes(SCRYPT_SALT_BYTES);
  const derived = await scrypt(password.normalize("NFKC"), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  // Parameters travel with the hash so they can be raised without a migration.
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(rawSalt!, "base64url");
  const expected = Buffer.from(rawHash!, "base64url");
  const derived = await scrypt(password.normalize("NFKC"), salt, expected.length, {
    N,
    r,
    p,
    maxmem: Math.max(SCRYPT_MAXMEM, 128 * N * r * 2),
  });
  return timingSafeEqual(derived, expected);
}

/**
 * A session token. The caller keeps this; only its hash is ever stored, so a
 * dump of the sessions table does not let anyone log in as anybody.
 */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Tokens are high-entropy already, so a single SHA-256 is the right hash here —
 * there is nothing to brute-force, and a slow KDF on every authenticated
 * request would be a self-inflicted denial of service.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function tokensMatch(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashToken(token));
  const expected = Buffer.from(storedHash);
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/**
 * A six-digit numeric OTP.
 *
 * randomInt, not Math.random: this is a credential. Padded rather than ranged
 * from 100000 so that every code is equally likely, including ones starting
 * with a zero.
 */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/**
 * Phone numbers are hashed before they are used as a key for the one-trial-per
 * -person record, which outlives the account. A pepper means that table is not
 * a rainbow-table-able list of everyone who ever signed up: the phone number
 * space is small enough to enumerate completely.
 */
export function hashPhone(phoneE164: string, pepper: string): string {
  return createHash("sha256").update(`${pepper}:${phoneE164}`).digest("base64url");
}

/**
 * Normalises an Iranian mobile number to E.164.
 *
 * People type 0912…, +98912…, 98912… and ۰۹۱۲… interchangeably, and Persian
 * digits arrive from Persian keyboards. All of them are the same person, and
 * storing them as different rows would hand each one a fresh free trial.
 */
export function normalizeIranianPhone(input: string): string | null {
  const latin = input
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\s()\-.]/g, "");
  const digits = latin.startsWith("+") ? latin.slice(1) : latin;
  if (!/^\d+$/.test(digits)) return null;

  // 9xxxxxxxxx is the mobile block; the other forms are prefixes onto it.
  if (/^989\d{9}$/.test(digits)) return `+${digits}`;
  if (/^09\d{9}$/.test(digits)) return `+98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+98${digits}`;
  return null;
}
