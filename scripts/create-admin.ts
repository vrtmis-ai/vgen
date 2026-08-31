/**
 * Create a staff account that can actually open /admin.
 *
 * The panel needs three things the product's own sign-up cannot give anyone: a
 * password, the `admin` role, and a confirmed TOTP factor — `POST
 * /admin/session` refuses an account with no second factor outright, because
 * letting someone in "just this once" is how `v_admins_without_mfa` stops being
 * empty. There was no way to produce that combination outside an integration
 * test, which meant the admin API had been complete and unreachable.
 *
 * Run:
 *   pnpm admin:create you@example.com 'a-long-password'
 *
 * It prints an `otpauth://` URI. Add it to an authenticator app before you
 * close the terminal: the secret is sealed into the database and this is the
 * only moment it exists in a form you can read. Losing it means running this
 * again with a different address.
 *
 * The database host must be local or the compose service name — anything else
 * is refused, because staff credentials belong to the deployment that will use
 * them. On a real deployment run it inside the stack, where the environment
 * carries a real `MFA_SEALING_KEY`:
 *
 *   docker compose --env-file .env.production -f docker-compose.prod.yml  *     run --rm seed pnpm admin:create you@example.com 'a-long-password'
 *
 * `MFA_SEALING_KEY` defaults to a known string here just as it does in the API,
 * so without a real one every TOTP secret this wrote would be openable by
 * anyone holding a database dump and this file. In production that is refused
 * rather than defaulted.
 */
import { hashPassword, sealSecret, sealingKeyFrom, generateTotpSecret, totpEnrolmentUri, assertUsablePassword } from "@vgen/core";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const [email, password] = process.argv.slice(2);
if (!email || !password) {
  throw new Error("usage: pnpm admin:create <email> <password>");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// A staff password and a sealed TOTP secret written by a script that defaults
// its sealing key is a local convenience and a production incident.
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1", "postgres"].includes(host)) {
  throw new Error(`refusing to write staff credentials to ${host} — this script is for a local database only`);
}

// `postgres` is in that list because it is the compose service name, so this
// script is also how a real deployment gets its first staff account — and there
// the sealing key stops being a detail. Sealed with the local default below,
// which is a constant published in this repository, a TOTP secret is not a
// second factor at all: anyone holding a database dump can generate the codes.
// The API refuses to boot in production without a real key; this refuses to
// write credentials before one exists, which is the same rule half an hour
// earlier.
if (process.env.NODE_ENV === "production" && !process.env.MFA_SEALING_KEY?.trim()) {
  throw new Error("MFA_SEALING_KEY must be set before writing staff credentials in production");
}

// Refused rather than accepted-and-warned. The whole point of the second factor
// below is that the first one is worth something.
assertUsablePassword(password);

const sealingKey = sealingKeyFrom(process.env.MFA_SEALING_KEY?.trim() || "deev-local-mfa-key");
const sql = postgres(databaseUrl, { max: 1 });

try {
  const secret = generateTotpSecret();

  await sql.begin(async (tx) => {
    const [role] = await tx<{ code: string }[]>`select code from roles where code = 'admin'`;
    if (!role) throw new Error("no 'admin' role — run pnpm db:migrate first");

    const [existing] = await tx<{ id: string }[]>`select id from users where email = ${email}`;
    let userId = existing?.id;

    if (!userId) {
      const [account] = await tx<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
      const [user] = await tx<{ id: string }[]>`
        insert into users (email, email_verified_at, password_hash, display_name, locale, personal_account_id)
        values (${email}, now(), ${await hashPassword(password)}, 'Staff', 'fa', ${account!.id})
        returning id
      `;
      userId = user!.id;
    } else {
      // Re-running is how you reset a password you have lost, so it overwrites
      // rather than refusing.
      await tx`update users set password_hash = ${await hashPassword(password)} where id = ${userId}`;
    }

    await tx`
      insert into user_roles (user_id, role_code) values (${userId}, 'admin')
      on conflict (user_id, role_code) do nothing
    `;

    // `confirmed_at` is set here rather than left for a first successful code.
    // The API's own enrolment flow would confirm it; there is no such flow yet,
    // and an unconfirmed factor is invisible to `verifySecondFactor` — the
    // account would be locked out of the panel it was just given.
    await tx`
      insert into mfa_credentials (user_id, kind, secret_ref, label, confirmed_at)
      values (${userId}, 'totp', ${sealSecret(secret, sealingKey)}, 'default', now())
      on conflict (user_id, kind, label) do update set
        secret_ref = excluded.secret_ref,
        confirmed_at = now()
    `;
  });

  console.log(`\nstaff account ready: ${email}`);
  console.log("\nAdd this to an authenticator app now — it is not stored anywhere readable:\n");
  console.log(`  ${totpEnrolmentUri(secret, email)}\n`);
  console.log(`  (manual entry, if the app wants the key alone: ${secret})\n`);
  console.log("Then open /admin, sign in with the password, and enter the six-digit code.");
} finally {
  await sql.end();
}
