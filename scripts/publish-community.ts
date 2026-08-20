/**
 * Seed the community feed, and the fake people behind it.
 *
 * THIS SCRIPT CREATES USERS. Ten of them, plus an account each, and they are
 * placeholders for a feed that has never had a real submission in it. Every one
 * is findable and removable with a single predicate:
 *
 *   delete from users where email like '%@demo.invalid'
 *
 * `.invalid` is reserved by RFC 2606 and can never be registered, so none of
 * these addresses can reach a real inbox even by accident, and none of them can
 * ever collide with a real signup. They carry no password hash and no phone, so
 * there is no credential to leak and no way to authenticate as one.
 *
 * The pictures are picsum stand-ins keyed by `seed` rather than real
 * generations, so each post's asset carries no storage object and records its
 * aspect ratio in `metadata` — `width` and `height` are pixel counts and 16 by
 * 9 is a ratio, not a size. When real posts arrive this seeder is deleted along
 * with the rows it wrote.
 *
 * Idempotent by construction like every other publisher here, and for a sharper
 * reason: re-running it must never mint a second set of users.
 *
 * Run: pnpm community:publish   (needs DATABASE_URL)
 */
import { createHash } from "node:crypto";
import { config } from "dotenv";
import postgres from "postgres";
import seed from "../src/data/community.rows.json" with { type: "json" };

config({ path: ".env.development.local", quiet: true });
config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to publish the community feed");

/** The one marker everything below is found and deleted by. */
const DEMO_DOMAIN = "demo.invalid";

/**
 * A stable uuid for a seeded row, derived from its code.
 *
 * `posts.id` defaults to `uuid_generate_v7()`, which is right for a real post
 * and wrong for a seeded one: CI builds an empty database every run, so a
 * generated id would differ between machines and the committed feed snapshot
 * could never be diffed — the check that proves the repository still serves
 * what it seeded would just be noise.
 *
 * RFC 4122 version 5, computed here rather than in SQL because this database
 * carries pgcrypto, not uuid-ossp, so `uuid_generate_v5` does not exist.
 */
const NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8"; // RFC 4122 URL namespace
function stableId(name: string): string {
  const namespace = Buffer.from(NAMESPACE.replace(/-/g, ""), "hex");
  const hash = createHash("sha1")
    .update(Buffer.concat([namespace, Buffer.from(`vgen:community:${name}`)]))
    .digest();
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = hash.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface SeedPost {
  code: string;
  author: string;
  ownerRef: string;
  kind: string;
  status: string;
  consentAt: number;
  familyCode: string;
  prompt: string;
  seed: string;
  aspectW: number;
  aspectH: number;
  likes: number;
}

const rows = seed.rows as unknown as SeedPost[];
const sql = postgres(databaseUrl, { max: 1 });

try {
  const summary = await sql.begin(async (tx) => {
    const written = { users: 0, assets: 0, posts: 0 };

    // A post naming a family the catalogue does not carry is a card with a
    // vendor mark for a model nobody can open. Same rule as publish-content.
    const families = await tx<{ family: string }[]>`
      select distinct model.family from provider_models model
      join providers provider on provider.id = model.provider_id
      where model.is_active and provider.is_active and model.capabilities ? 'variant' and model.family is not null
    `;
    const known = new Set(families.map((row) => row.family));
    if (known.size === 0) throw new Error("the catalogue is empty — run pnpm catalog:publish first");
    for (const row of rows) {
      if (!known.has(row.familyCode)) {
        throw new Error(`community post ${row.code} names family "${row.familyCode}", which no active model carries`);
      }
    }

    for (const row of rows) {
      const email = `${row.ownerRef}@${DEMO_DOMAIN}`;

      // The account first — `users.personal_account_id` points at it, and a
      // user without one cannot own anything.
      let [account] = await tx<{ id: string }[]>`
        select a.id from users u join accounts a on a.id = u.personal_account_id where u.email = ${email}
      `;
      if (!account) {
        [account] = await tx<{ id: string }[]>`insert into accounts (kind) values ('personal') returning id`;
      }
      if (!account) throw new Error(`could not resolve an account for ${email}`);

      // No password_hash and no phone: there is nothing here to sign in with.
      const [user] = await tx<{ id: string }[]>`
        insert into users (email, handle, display_name, locale, personal_account_id)
        values (${email}, ${row.author}, ${row.author}, 'fa', ${account.id})
        on conflict (email) do update set
          handle = excluded.handle,
          display_name = excluded.display_name
        where users.handle is distinct from excluded.handle or users.display_name is distinct from excluded.display_name
        returning id
      `;
      if (user) written.users += 1;
      const userId = user?.id ?? (await tx<{ id: string }[]>`select id from users where email = ${email}`)[0]?.id;
      if (!userId) throw new Error(`user upsert lost ${email}`);

      // `origin: 'system'` and a storage key that names the seeder rather than
      // an object, because there is no object — the picture is generated by the
      // browser from `metadata.seed`. The key still has to be unique, and
      // saying where it came from is more use than a random string.
      const storageKey = `demo/community/${row.code}`;
      const metadata = { seed: row.seed, aspectW: row.aspectW, aspectH: row.aspectH, placeholder: true };
      const [asset] = await tx<{ id: string }[]>`
        insert into assets (account_id, created_by, kind, origin, storage_bucket, storage_key, mime_type, moderation_state, visibility, metadata)
        values (
          ${account.id}, ${userId}, ${row.kind === "reel" ? "video" : row.kind}, 'system',
          'vgen-demo', ${storageKey}, ${row.kind === "image" ? "image/jpeg" : "video/mp4"},
          'approved', 'public', ${tx.json(metadata as never)}
        )
        on conflict (storage_bucket, storage_key) do update set metadata = excluded.metadata
        where assets.metadata is distinct from excluded.metadata
        returning id
      `;
      if (asset) written.assets += 1;
      const assetId =
        asset?.id ??
        (await tx<{ id: string }[]>`select id from assets where storage_bucket = 'vgen-demo' and storage_key = ${storageKey}`)[0]?.id;
      if (!assetId) throw new Error(`asset upsert lost ${storageKey}`);

      const consent = new Date(row.consentAt);
      // The id is the natural key here, because it is derived from the code.
      // `title` still holds the code so a person reading the table can see
      // which seed row this is; nothing renders it.
      const postId = stableId(row.code);
      const [existing] = await tx<{ id: string }[]>`select id from posts where id = ${postId}`;
      if (existing) {
        await tx`
          update posts set
            caption = ${row.prompt}, status = ${row.status}, like_count = ${row.likes},
            kind = ${row.kind}, family_code = ${row.familyCode}, cover_asset_id = ${assetId}
          where id = ${existing.id}
            and (caption is distinct from ${row.prompt} or status is distinct from ${row.status}
                 or like_count is distinct from ${row.likes} or kind is distinct from ${row.kind}
                 or family_code is distinct from ${row.familyCode} or cover_asset_id is distinct from ${assetId})
        `;
        continue;
      }

      const [post] = await tx<{ id: string }[]>`
        insert into posts (
          id, account_id, author_user_id, cover_asset_id, title, caption, status,
          like_count, kind, family_code, consent_at, submitted_at, published_at
        )
        values (
          ${postId}, ${account.id}, ${userId}, ${assetId}, ${row.code}, ${row.prompt}, ${row.status},
          ${row.likes}, ${row.kind}, ${row.familyCode}, ${consent}, ${consent},
          ${row.status === "approved" ? consent : null}
        )
        returning id
      `;
      if (post) written.posts += 1;
      await tx`
        insert into post_assets (post_id, asset_id, position) values (${post!.id}, ${assetId}, 0)
        on conflict do nothing
      `;
    }

    return written;
  });

  const total = Object.values(summary).reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    console.log("community already current, nothing written");
  } else {
    console.log(`wrote ${summary.users} user, ${summary.assets} asset and ${summary.posts} post rows`);
  }
  console.log(`every author is fake. Remove them with: delete from users where email like '%@${DEMO_DOMAIN}'`);
} finally {
  await sql.end();
}
