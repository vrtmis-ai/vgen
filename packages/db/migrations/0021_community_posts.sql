-- =====================================================================
--  69. THREE THINGS A POST HAS TO CARRY ITSELF
--
--  `posts` has existed since 0001 and models a user submission properly:
--  ownership, moderation state, counts, a cover asset, the job behind it.
--  What it assumed is that everything else about a post could be reached
--  by following `job_id`. Three things cannot.
--
--  CONSENT. Publishing exposes the prompt, the settings and any reference
--  files the user uploaded, and §14 requires their agreement to be taken at
--  share time. A consent column added after posts exist has nothing
--  truthful to put in the rows that predate it — it is the one field here
--  that genuinely cannot be added later, so it is added now while the table
--  is empty. `submitted_at` is not a substitute: submitting is an action,
--  consenting is a permission, and a moderator re-queueing something must
--  not read as the author agreeing to it again.
--
--  KIND. A reel is assembled from several shots outside the app, so it has
--  no single job and no single asset to infer a type from. image/video can
--  be read off the cover asset; reel cannot be read off anything.
--
--  FAMILY. Which model made it, denormalised on purpose. Reels have no one
--  job to ask, and jobs are retention-limited while a post is not — so a
--  post whose job has aged out would otherwise stop being able to name the
--  model that made it, on a screen whose entire point is telling you.
--
--  All three are nullable: nothing here is retrofitted onto rows that
--  cannot answer, and a post created before a user consents has no consent
--  to record yet.
-- =====================================================================

ALTER TABLE posts
  ADD COLUMN consent_at  timestamptz,
  ADD COLUMN kind        text CHECK (kind IN ('image', 'video', 'reel')),
  ADD COLUMN family_code text;

-- The feed's only read: approved posts, newest first.
CREATE INDEX posts_feed_idx
  ON posts (published_at DESC NULLS LAST)
  WHERE status = 'approved' AND deleted_at IS NULL;

COMMENT ON COLUMN posts.consent_at IS
  'When the author agreed to publish prompt, settings and reference files. Taken at share time; never backfilled.';
COMMENT ON COLUMN posts.kind IS
  'image and video are also readable from the cover asset; reel is not, because a reel is assembled outside the app.';
COMMENT ON COLUMN posts.family_code IS
  'provider_models.family, denormalised: reels have no single job and jobs age out while posts do not.';
