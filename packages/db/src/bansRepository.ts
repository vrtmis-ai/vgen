import type { Sql } from "postgres";

/**
 * Bans, and what they actually stop.
 *
 * The `bans` table has existed since migration 0001 and until now appeared
 * nowhere else in the repository — nothing wrote a row and nothing read one. A
 * panel that could write one would have been worse than no panel at all: staff
 * would mark an account banned, see it listed as banned, and the account would
 * carry on generating. An unenforced ban is not a partial feature, it is a
 * false statement in the admin UI.
 *
 * **A ban does not stop sign-in.** That is a decision, not an omission. Someone
 * who paid for generations keeps access to the ones they already have — the
 * point of a ban here is to stop an account costing us provider money and to
 * stop it publishing, not to confiscate what it bought. `bans.scope` is what
 * says which of those is meant:
 *
 *   • `generation` — no new jobs. The one that costs money.
 *   • `explore` / `comments` — no publishing. The moderation ban.
 *   • `platform` — all of the above.
 *
 * Two columns decide whether a row still counts, and both are easy to forget:
 * `lifted_at` (somebody undid it) and `expires_at` (it ran out on its own,
 * null meaning permanent). Every query here honours both.
 */

export type BanScope = "platform" | "explore" | "comments" | "generation";

export interface BanRecord {
  id: string;
  userId: string;
  scope: BanScope;
  reason: string | null;
  createdBy: string | null;
  createdAt: number;
  expiresAt: number | null;
}

/** The scopes that stop a given action. `platform` is in every list by definition. */
const STOPS_GENERATION: BanScope[] = ["platform", "generation"];
const STOPS_PUBLISHING: BanScope[] = ["platform", "explore"];

/**
 * Is this user barred from starting a generation, right now?
 *
 * Takes an `Sql` so it can be called with an open transaction. The check inside
 * `createQueued` runs on the same connection that holds the credits, which is
 * what stops a ban landing in the gap between "allowed" and "charged".
 */
export async function isBannedFromGenerating(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await sql<{ banned: boolean }[]>`
    select exists(
      select 1 from bans
      where user_id = ${userId}
        and scope = any(${STOPS_GENERATION}::text[])
        and lifted_at is null
        and (expires_at is null or expires_at > now())
    ) as banned
  `;
  return row?.banned ?? false;
}

/**
 * Is this user barred from publishing?
 *
 * Nothing calls this yet, and that is worth saying out loud rather than hiding:
 * **there is no endpoint that publishes to the community.** `GET
 * /api/v1/community` is read-only and the seeded posts were written by
 * `scripts/publish-community.ts`. The scope is storable and a ban recorded
 * under it is real; it simply has nothing to refuse until a `POST` exists.
 * Whoever builds that route calls this from it.
 */
export async function isBannedFromPublishing(sql: Sql, userId: string): Promise<boolean> {
  const [row] = await sql<{ banned: boolean }[]>`
    select exists(
      select 1 from bans
      where user_id = ${userId}
        and scope = any(${STOPS_PUBLISHING}::text[])
        and lifted_at is null
        and (expires_at is null or expires_at > now())
    ) as banned
  `;
  return row?.banned ?? false;
}

const toBan = (row: {
  id: string;
  user_id: string;
  scope: BanScope;
  reason: string | null;
  created_by: string | null;
  created_at: Date;
  expires_at: Date | null;
}): BanRecord => ({
  id: row.id,
  userId: row.user_id,
  scope: row.scope,
  reason: row.reason,
  createdBy: row.created_by,
  createdAt: row.created_at.getTime(),
  expiresAt: row.expires_at?.getTime() ?? null,
});

export class PostgresBansRepository {
  constructor(private readonly sql: Sql) {}

  /** Every ban still in force for one user. Lifted and expired rows are gone from this. */
  async listActive(userId: string): Promise<BanRecord[]> {
    const rows = await this.sql<Parameters<typeof toBan>[0][]>`
      select id, user_id, scope, reason, created_by, created_at, expires_at
      from bans
      where user_id = ${userId} and lifted_at is null and (expires_at is null or expires_at > now())
      order by created_at desc
    `;
    return rows.map(toBan);
  }

  async create(input: {
    userId: string;
    scope: BanScope;
    reason?: string | undefined;
    expiresAt?: Date | undefined;
    createdBy: string;
  }): Promise<BanRecord> {
    const [row] = await this.sql<Parameters<typeof toBan>[0][]>`
      insert into bans (user_id, scope, reason, expires_at, created_by)
      values (${input.userId}, ${input.scope}, ${input.reason ?? null}, ${input.expiresAt ?? null}, ${input.createdBy})
      returning id, user_id, scope, reason, created_by, created_at, expires_at
    `;
    return toBan(row!);
  }

  /**
   * Lift a ban.
   *
   * `lifted_at` is stamped rather than the row deleted. "Was this account ever
   * banned, and who undid it" is a question a dispute turns on, and a DELETE
   * answers it with silence.
   */
  async lift(banId: string): Promise<boolean> {
    const rows = await this.sql<{ id: string }[]>`
      update bans set lifted_at = now() where id = ${banId} and lifted_at is null returning id
    `;
    return rows.length > 0;
  }
}
