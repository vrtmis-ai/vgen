/**
 * Change which role somebody holds, from a terminal on the database's own host.
 *
 * There is one role the panel cannot hand out to the first person who needs it:
 * `owner`. Only an owner may appoint an owner (migration 0035), so on a
 * deployment that has never had one the panel offers `admin` at most and the
 * first owner has to come from outside it. That is this.
 *
 * Run:
 *   pnpm staff:promote you@example.com owner
 *
 * Deliberately not part of `admin:create`, which overwrites the password of an
 * address that already exists — promoting somebody should not make them retype
 * their password, and a script that quietly resets one is a footgun.
 *
 * It touches `user_roles` and nothing else: no account is created, no password
 * is written, no TOTP secret is sealed. So it has no sealing key to get wrong,
 * and the local-host rule below is about which deployment you are editing
 * rather than about secrets.
 *
 * On a real deployment, inside the stack:
 *
 *   docker compose --env-file .env.production -f docker-compose.prod.yml \
 *     run --rm seed pnpm staff:promote you@example.com owner
 *
 * The person's old role is removed, so this is a move rather than an addition —
 * holding both `owner` and `admin` resolves to the higher of the two anyway,
 * and two rows would only make the staff list say the same person twice.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const [email, roleCode] = process.argv.slice(2);
if (!email || !roleCode) {
  throw new Error("usage: pnpm staff:promote <email> <roleCode>");
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required");

// The same rule `create-admin.ts` keeps: who runs a deployment is decided on
// that deployment, from a shell somebody already had to get into.
const host = new URL(databaseUrl).hostname;
if (!["127.0.0.1", "localhost", "::1", "postgres"].includes(host)) {
  throw new Error(`refusing to change roles on ${host} — this script is for a local database only`);
}

const sql = postgres(databaseUrl, { max: 1 });

try {
  const [role] = await sql<{ code: string; name: string; rank: number }[]>`
    select code, name, rank from roles where code = ${roleCode} and code <> 'user'
  `;
  if (!role) {
    const all = await sql<{ code: string }[]>`select code from roles where code <> 'user' order by rank desc`;
    throw new Error(`no such role: ${roleCode}. Try one of ${all.map((row) => row.code).join(", ")}`);
  }

  const [user] = await sql<{ id: string }[]>`
    select id from users where email = ${email.trim().toLowerCase()} and deleted_at is null and status = 'active'
  `;
  if (!user) throw new Error(`nobody signs in with ${email}. Create the account first: pnpm admin:create ${email} '<password>'`);

  const before = await sql<{ role_code: string }[]>`select role_code from user_roles where user_id = ${user.id} and role_code <> 'user'`;

  await sql.begin(async (tx) => {
    await tx`delete from user_roles where user_id = ${user.id} and role_code <> 'user' and role_code <> ${roleCode}`;
    await tx`
      insert into user_roles (user_id, role_code, granted_by)
      values (${user.id}, ${roleCode}, ${user.id})
      on conflict (user_id, role_code) do nothing
    `;
    /* Written like every other role change, because the audit log is supposed
       to answer "how did this person get this access" without exceptions, and
       a change made from a shell is exactly the one somebody will ask about. */
    await tx`
      insert into audit_log (actor_user_id, action, target_type, target_id, before_state, after_state)
      values (${user.id}, 'staff.promoted', 'user', ${user.id},
              ${tx.json({ roles: before.map((row) => row.role_code) })},
              ${tx.json({ roleCode, via: "scripts/promote-staff.ts" })})
    `;
  });

  const held = await sql<{ role_code: string }[]>`select role_code from user_roles where user_id = ${user.id} and role_code <> 'user'`;
  console.log(`${email} now holds ${held.map((row) => row.role_code).join(", ")} (${role.name}, rank ${role.rank})`);
  if (before.length > 0) console.log(`was ${before.map((row) => row.role_code).join(", ")}`);
} finally {
  await sql.end();
}
