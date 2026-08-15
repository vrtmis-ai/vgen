-- =====================================================================
--  007 — LEAST PRIVILEGE, FK INDEXES, SEARCH, VACUUM, DELETION PATH
--
--  Everything here is database work that does not depend on your app code
--  or your provider data. The collation change that goes with it lives in
--  docker-compose.yml, because it can only be set when the cluster is
--  created.
-- =====================================================================

BEGIN;

-- =====================================================================
--  50. ROLES — stop the application from connecting as superuser
--
--  These are GROUP roles with no password and no login. Create the real
--  login user separately so no credential ever lands in this repo:
--
--    CREATE USER deev_api PASSWORD '…' IN ROLE deev_app;
--    CREATE USER metabase PASSWORD '…' IN ROLE deev_readonly;
--
--  deev_app can read and write rows. It owns nothing, so it cannot DROP,
--  ALTER or TRUNCATE anything — an injected statement is a data problem,
--  not a "the schema is gone" problem.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deev_app') THEN
    CREATE ROLE deev_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deev_readonly') THEN
    CREATE ROLE deev_readonly NOLOGIN;
  END IF;
END $$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO deev_app, deev_readonly;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO deev_app;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO deev_app;
GRANT EXECUTE                        ON ALL FUNCTIONS IN SCHEMA public TO deev_app;
GRANT SELECT                         ON ALL TABLES    IN SCHEMA public TO deev_readonly;

-- future tables inherit the same grants, so a new migration cannot
-- accidentally leave the app locked out of its own table
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO deev_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO deev_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO deev_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO deev_readonly;

-- The audit trail is evidence. The application writes to it and never
-- edits it, which is a grant, not a convention.
REVOKE UPDATE, DELETE ON audit_log FROM deev_app;
-- Same for the ledger. The append-only RULE already blocks this, but a
-- rule can be dropped by a superuser typo and a grant cannot.
REVOKE UPDATE, DELETE ON credit_ledger FROM deev_app;
-- Nothing but a migration should be rewriting pricing history.
REVOKE UPDATE, DELETE ON model_prices, provider_credit_rates FROM deev_app;


-- =====================================================================
--  51. FOREIGN KEY INDEXES
--
--  Postgres does not index FK columns for you. An unindexed FK costs you
--  a sequential scan of the child every time the parent row is deleted or
--  its key updated — and with ON DELETE CASCADE that is per parent row.
--
--  Indexed below: columns on a real delete path, or that the app filters
--  by. Deliberately NOT indexed: created_by / updated_by / granted_by /
--  reviewer / assigned_to audit columns. Nobody queries by them, the rows
--  they point at are never deleted, and 100 extra indexes would tax every
--  single write to pay for a scan that never happens.
-- =====================================================================

-- account-owned content: filtered constantly, and cascades on account close
CREATE INDEX IF NOT EXISTS posts_account_id_idx             ON posts (account_id);
CREATE INDEX IF NOT EXISTS conversations_account_id_idx     ON conversations (account_id);
CREATE INDEX IF NOT EXISTS moderation_items_account_id_idx  ON moderation_items (account_id);
CREATE INDEX IF NOT EXISTS promo_redemptions_account_id_idx ON promo_redemptions (account_id);
CREATE INDEX IF NOT EXISTS trial_grants_account_id_idx      ON trial_grants (account_id);
CREATE INDEX IF NOT EXISTS users_personal_account_id_idx    ON users (personal_account_id);

-- user-owned rows that CASCADE or SET NULL when a user is removed
CREATE INDEX IF NOT EXISTS collections_user_id_idx          ON collections (user_id);
CREATE INDEX IF NOT EXISTS device_fingerprints_user_id_idx  ON device_fingerprints (user_id);
CREATE INDEX IF NOT EXISTS auth_tokens_user_id_idx          ON auth_tokens (user_id);
CREATE INDEX IF NOT EXISTS reports_reporter_user_id_idx     ON reports (reporter_user_id);
CREATE INDEX IF NOT EXISTS login_attempts_user_id_idx       ON login_attempts (user_id);
CREATE INDEX IF NOT EXISTS rate_limit_violations_account_id_idx
  ON rate_limit_violations (account_id) WHERE account_id IS NOT NULL;

-- lineage and media lookups the product actually performs
CREATE INDEX IF NOT EXISTS jobs_parent_job_id_idx           ON jobs (parent_job_id)
  WHERE parent_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_remixed_from_post_id_idx   ON posts (remixed_from_post_id)
  WHERE remixed_from_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_job_id_idx                 ON posts (job_id);
CREATE INDEX IF NOT EXISTS posts_cover_asset_id_idx         ON posts (cover_asset_id);
CREATE INDEX IF NOT EXISTS post_assets_asset_id_idx         ON post_assets (asset_id);
CREATE INDEX IF NOT EXISTS assets_thumbnail_asset_id_idx    ON assets (thumbnail_asset_id)
  WHERE thumbnail_asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversation_documents_asset_id_idx
  ON conversation_documents (asset_id);
CREATE INDEX IF NOT EXISTS credit_ledger_lot_id_idx         ON credit_ledger (lot_id)
  WHERE lot_id IS NOT NULL;


-- =====================================================================
--  52. SEARCH
--
--  Trigram, not tsvector: Postgres ships no Persian text search
--  configuration, so to_tsvector('english', 'سلام') gives you nothing
--  useful. Trigrams are language-agnostic, match substrings, and survive
--  the spelling variants (ی/ي, ک/ك) that a stemmer would not.
-- =====================================================================

CREATE INDEX IF NOT EXISTS posts_title_trgm ON posts
  USING gin (title gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS posts_caption_trgm ON posts
  USING gin (caption gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS skills_name_trgm ON skills
  USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS tags_name_trgm ON tags
  USING gin (name gin_trgm_ops);


-- =====================================================================
--  53. VACUUM & FILLFACTOR ON THE HOT TABLES
--
--  Defaults assume a table is vacuumed once 20% of it is dead. On a table
--  taking thousands of writes an hour that is far too late, and autovacuum
--  ends up doing its largest work exactly when you are busiest.
--
--  fillfactor leaves free space in each page so a row update can stay on
--  its own page (a HOT update) and skip touching every index on the table.
--  Only worth it where rows are updated repeatedly in place.
-- =====================================================================

-- updated several times per row: queued -> running -> succeeded
ALTER TABLE jobs SET (autovacuum_vacuum_scale_factor = 0.02,
                      autovacuum_analyze_scale_factor = 0.01,
                      fillfactor = 85);

-- one row per account, rewritten on every single charge
ALTER TABLE account_balances SET (autovacuum_vacuum_scale_factor = 0.01,
                                  fillfactor = 70);

-- last_used_at is touched on every authenticated request
ALTER TABLE sessions SET (autovacuum_vacuum_scale_factor = 0.05,
                          fillfactor = 85);

-- insert, then update processed_at, then delete: the classic churn table
ALTER TABLE outbox SET (autovacuum_vacuum_scale_factor = 0.01,
                        autovacuum_vacuum_cost_delay = 0);

-- append-only but huge; analyze often so the planner keeps up
ALTER TABLE credit_ledger SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE messages       SET (autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE assets         SET (autovacuum_vacuum_scale_factor = 0.05,
                                autovacuum_analyze_scale_factor = 0.02);
ALTER TABLE notifications  SET (autovacuum_vacuum_scale_factor = 0.05);

-- counters are rewritten on every like and comment
ALTER TABLE posts SET (fillfactor = 90);


-- =====================================================================
--  54. ACCOUNT DELETION
--
--  Policy: anonymize, do not erase. Financial records must survive for
--  accounting, remix lineage must survive so other people's posts do not
--  break, and trial_grants must survive or "delete account, sign up
--  again" becomes a free credit generator.
--
--  What is destroyed is everything that identifies the person: email,
--  phone, handle, display name, avatar, login identities, sessions, MFA,
--  API keys. What remains cannot be traced back to them.
-- =====================================================================

CREATE TABLE deletion_requests (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by  uuid REFERENCES users(id),
  reason        text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','scheduled','completed','cancelled')),
  -- grace period: an account recovered on day 3 is a saved customer
  scheduled_for timestamptz NOT NULL DEFAULT now() + interval '14 days',
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON deletion_requests (scheduled_for) WHERE status = 'scheduled';
CREATE UNIQUE INDEX ON deletion_requests (user_id) WHERE status IN ('pending','scheduled');

CREATE OR REPLACE FUNCTION anonymize_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- users CHECKs that email or phone is present, so the email becomes an
  -- unroutable placeholder rather than null. It stays unique per user.
  UPDATE users SET
    email             = 'deleted+' || p_user_id::text || '@invalid',
    phone             = NULL,
    email_verified_at = NULL,
    phone_verified_at = NULL,
    password_hash     = NULL,
    handle            = NULL,
    display_name      = NULL,
    avatar_asset_id   = NULL,
    status            = 'deleted',
    deleted_at        = now(),
    updated_at        = now()
  WHERE id = p_user_id;

  UPDATE user_profiles SET bio = NULL, links = '{}'::jsonb,
                           cover_asset_id = NULL, is_public = false
   WHERE user_id = p_user_id;

  UPDATE sessions SET revoked_at = now()
   WHERE user_id = p_user_id AND revoked_at IS NULL;
  UPDATE api_keys SET revoked_at = now()
   WHERE created_by = p_user_id AND revoked_at IS NULL;

  DELETE FROM auth_identities         WHERE user_id = p_user_id;
  DELETE FROM mfa_credentials         WHERE user_id = p_user_id;
  DELETE FROM mfa_recovery_codes      WHERE user_id = p_user_id;
  DELETE FROM auth_tokens             WHERE user_id = p_user_id;
  DELETE FROM notification_preferences WHERE user_id = p_user_id;
  DELETE FROM notifications           WHERE user_id = p_user_id;

  -- the fingerprint stops identifying a person but still links the accounts
  UPDATE device_fingerprints SET user_id = NULL WHERE user_id = p_user_id;

  UPDATE deletion_requests SET status = 'completed', completed_at = now()
   WHERE user_id = p_user_id AND status IN ('pending','scheduled');
END $$;

-- Deliberately untouched by the above, and each for a reason:
--   orders, payments, credit_ledger, subscriptions -> accounting record
--   posts, post_comments                           -> other people's remixes
--   trial_grants                                   -> anti-abuse memory
--   audit_log, moderation_actions                  -> evidence

COMMIT;
