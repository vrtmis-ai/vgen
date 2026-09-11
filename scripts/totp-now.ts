/**
 * Print the live TOTP code for a local staff account.
 *
 * Run: pnpm tsx scripts/totp-now.ts you@example.com
 *
 * `admin:create` prints the secret once and never again, which is correct for a
 * second factor and unhelpful the moment the enrolment is lost. This reads the
 * sealed secret back out of the database with the same key the API uses, so a
 * lost authenticator does not mean a new account.
 *
 * The neighbouring time steps are printed because a rejected code is far more
 * often a clock that has drifted than a secret that is wrong: if the code your
 * phone shows matches the -30s or +30s row rather than "now", the two disagree
 * about the time, and that is what needs fixing.
 *
 * LOCAL DEVELOPMENT ONLY — this prints the second factor in plaintext, and
 * refuses to run against a database that does not look local.
 */
import { openSecret, sealingKeyFrom, totpCode } from "@vgen/core";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const email = process.argv[2];
if (!email) throw new Error("usage: pnpm tsx scripts/totp-now.ts <email>");

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const host = new URL(databaseUrl).hostname;
// Not "postgres": that is the database's hostname inside docker-compose.prod.yml,
// so allowing it would let this run on the production server it promises to refuse.
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`refusing to print a second factor from ${host} — this script is for a local database only`);
}

const sealingKey = sealingKeyFrom(process.env.MFA_SEALING_KEY?.trim() || "deev-local-mfa-key");
const sql = postgres(databaseUrl, { max: 1 });

try {
  const [row] = await sql<{ secret_ref: string; confirmed: boolean }[]>`
    select m.secret_ref, m.confirmed_at is not null as confirmed
    from users u join mfa_credentials m on m.user_id = u.id
    where u.email = ${email} and m.kind = 'totp'
  `;
  if (!row) throw new Error(`no TOTP credential for ${email} — run pnpm admin:create first`);

  const secret = openSecret(row.secret_ref, sealingKey);
  const now = Date.now();

  console.log(`account:    ${email}`);
  console.log(`confirmed:  ${row.confirmed}`);
  console.log(`secret:     ${secret}`);
  console.log(`host clock: ${new Date(now).toISOString()}`);
  console.log(`this code is valid for another ${30 - (Math.floor(now / 1000) % 30)}s`);
  console.log("");
  for (const step of [-1, 0, 1]) {
    const label = step === 0 ? "now " : step < 0 ? "-30s" : "+30s";
    console.log(`  ${label}  ${totpCode(secret, now + step * 30_000)}`);
  }
} finally {
  await sql.end();
}
