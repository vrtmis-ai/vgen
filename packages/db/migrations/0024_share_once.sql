-- 0024 — a generation may be shared into the feed once.
--
-- `POST /api/v1/community` lands in this migration's company: it turns a
-- finished job into a pending post. Nothing stopped the same job becoming two
-- posts, and the ways that happens are ordinary rather than malicious — a
-- double-tapped button, a retried request on a flaky connection, a client that
-- resends on timeout after the insert already committed.
--
-- The duplicate is worse than untidy. Both copies enter the moderation queue,
-- so a moderator reviews the same picture twice; approve both and the feed
-- shows one person's work twice in a row, which reads as the feed being broken.
--
-- Partial on two counts, and both are load-bearing:
--
--   * `job_id IS NOT NULL` — the seeded demo posts have no job behind them and
--     never will. Without this they would collide with each other on NULL in
--     any index that treated NULLs as equal, and the seeder would stop being
--     re-runnable.
--   * `deleted_at IS NULL` — deleting a post has to release the job. Otherwise
--     an author who removes something can never share it again, and the error
--     they would get names a row they cannot see.

CREATE UNIQUE INDEX IF NOT EXISTS posts_one_per_job_idx
  ON posts (job_id)
  WHERE job_id IS NOT NULL AND deleted_at IS NULL;

COMMENT ON INDEX posts_one_per_job_idx IS
  'One live post per generation. Seeded posts (job_id null) and deleted posts are exempt.';
