-- =====================================================================
--  002 — COMMERCE, CATALOG & THE COUNTERS schema.sql LEFT UNWIRED
--
--  Decisions this encodes:
--    * Subscriptions, no top-up packs. Running out mid-term = buy another
--      term, so several may be live at once. One row = one purchased term.
--    * Sold in IRR, paid to providers in USD -> every order snapshots FX.
--    * Presets are a browsable catalog with preview media, not a dropdown.
--    * Queue lives in an external broker, so jobs gets no lease columns.
--
--  Apply: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 002_commerce.sql
-- =====================================================================

BEGIN;

-- =====================================================================
--  20. FX — you price in Toman, providers bill you in dollars
-- =====================================================================

CREATE TABLE fx_rates (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  base_currency   text NOT NULL DEFAULT 'USD',
  quote_currency  text NOT NULL,                  -- 'IRR'
  rate            numeric(20,6) NOT NULL,         -- 1 base = <rate> quote
  source          text,                           -- 'manual','tgju','nobitex'
  valid_from      timestamptz NOT NULL DEFAULT now(),
  valid_to        timestamptz,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (rate > 0)
);
CREATE UNIQUE INDEX ON fx_rates (base_currency, quote_currency) WHERE valid_to IS NULL;
CREATE INDEX ON fx_rates (quote_currency, valid_from DESC);

-- Orders remember what a dollar cost on the day they were paid. Without this
-- every margin number silently rewrites itself when the rate moves.
ALTER TABLE orders
  ADD COLUMN fx_rate_id uuid REFERENCES fx_rates(id),
  ADD COLUMN amount_usd numeric(14,4);


-- =====================================================================
--  21. PLANS & SUBSCRIPTIONS
--  A plan is what you sell. A subscription row is one purchased term.
--  Buying again before expiry just adds another row — entitlements are
--  the best of everything currently live, credits stack as separate lots.
-- =====================================================================

CREATE TABLE plans (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                     text NOT NULL UNIQUE,      -- 'starter','pro','studio'
  name                     text NOT NULL,
  description              text,
  micro_credits_per_term   bigint NOT NULL,
  term_days                integer NOT NULL DEFAULT 30,
  price_amount             numeric(14,2) NOT NULL,
  currency                 text NOT NULL DEFAULT 'IRR',
  -- entitlements you filter or enforce on get real columns …
  max_concurrent_jobs      integer NOT NULL DEFAULT 3,
  daily_job_cap            integer,
  max_resolution_px        integer NOT NULL DEFAULT 720,   -- 720 / 1080 / 2160
  max_video_seconds        numeric(6,2),
  allow_premium_skills     boolean NOT NULL DEFAULT false,
  allow_nsfw               boolean NOT NULL DEFAULT false,
  credits_roll_over        boolean NOT NULL DEFAULT false,
  -- … everything else lives here so a new perk is not a migration
  entitlements             jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_public                boolean NOT NULL DEFAULT true,
  is_active                boolean NOT NULL DEFAULT true,
  sort_order               integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON plans (sort_order) WHERE is_active AND is_public;

CREATE TABLE subscriptions (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id             uuid NOT NULL REFERENCES accounts(id),
  plan_id                uuid NOT NULL REFERENCES plans(id),
  order_id               uuid REFERENCES orders(id),
  -- price and perks exactly as sold; changing the plan tomorrow must not
  -- retroactively change what someone already bought
  plan_snapshot          jsonb NOT NULL DEFAULT '{}'::jsonb,
  micro_credits_granted  bigint NOT NULL DEFAULT 0,
  lot_id                 uuid REFERENCES credit_lots(id),   -- credits this term created
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','active','expired','cancelled','refunded')),
  starts_at              timestamptz NOT NULL DEFAULT now(),
  ends_at                timestamptz NOT NULL,
  cancelled_at           timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX ON subscriptions (account_id, ends_at DESC);
CREATE INDEX ON subscriptions (ends_at) WHERE status = 'active';
CREATE INDEX ON subscriptions (plan_id, created_at DESC);

ALTER TABLE orders ADD COLUMN plan_id uuid REFERENCES plans(id);

-- What is this account allowed to do right now? account_limits stays an
-- admin override that can only ever raise the ceiling, never lower it.
CREATE VIEW v_account_entitlements AS
SELECT
  acc.id AS account_id,
  COALESCE(sub.plans, ARRAY[]::text[])                                    AS active_plans,
  GREATEST(COALESCE(sub.max_concurrent_jobs, 0),
           COALESCE(lim.max_concurrent_jobs, 0), 1)                       AS max_concurrent_jobs,
  COALESCE(GREATEST(sub.daily_job_cap, lim.daily_job_cap),
           sub.daily_job_cap, lim.daily_job_cap)                          AS daily_job_cap,
  COALESCE(sub.max_resolution_px, 720)                                    AS max_resolution_px,
  COALESCE(sub.max_video_seconds, 5)                                      AS max_video_seconds,
  COALESCE(sub.allow_premium_skills, false)                               AS allow_premium_skills,
  COALESCE(lim.allow_nsfw, false) OR COALESCE(sub.allow_nsfw, false)      AS allow_nsfw,
  sub.access_until,
  sub.plans IS NOT NULL                                                   AS is_subscribed
FROM accounts acc
LEFT JOIN account_limits lim ON lim.account_id = acc.id
LEFT JOIN LATERAL (
  SELECT array_agg(DISTINCT p.code)      AS plans,
         max(p.max_concurrent_jobs)      AS max_concurrent_jobs,
         max(p.daily_job_cap)            AS daily_job_cap,
         max(p.max_resolution_px)        AS max_resolution_px,
         max(p.max_video_seconds)        AS max_video_seconds,
         bool_or(p.allow_premium_skills) AS allow_premium_skills,
         bool_or(p.allow_nsfw)           AS allow_nsfw,
         max(s.ends_at)                  AS access_until
  FROM subscriptions s
  JOIN plans p ON p.id = s.plan_id
  WHERE s.account_id = acc.id AND s.status = 'active' AND s.ends_at > now()
) sub ON true;


-- =====================================================================
--  22. PRESET CATALOG — the grid of looping previews IS the product
-- =====================================================================

CREATE TABLE skill_media (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  skill_version_id  uuid NOT NULL REFERENCES skill_versions(id) ON DELETE CASCADE,
  asset_id          uuid NOT NULL REFERENCES assets(id),
  role              text NOT NULL DEFAULT 'preview'
                      CHECK (role IN ('preview','cover','thumbnail','before','after')),
  position          integer NOT NULL DEFAULT 0,
  caption           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_version_id, asset_id, role)
);
CREATE INDEX ON skill_media (skill_version_id, position);
CREATE INDEX ON skill_media (asset_id);

-- Browsing needs shelves ("Camera moves", "Film looks"), and a skill can sit
-- on more than one. skills.category stays as its single home for admin lists.
CREATE TABLE skill_collections (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  description text,
  cover_asset_id uuid REFERENCES assets(id),
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE skill_collection_items (
  collection_id uuid NOT NULL REFERENCES skill_collections(id) ON DELETE CASCADE,
  skill_id      uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  position      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (collection_id, skill_id)
);
CREATE INDEX ON skill_collection_items (skill_id);


-- =====================================================================
--  23. PROVIDER KEYS & HEALTH — what makes is_fallback mean anything
-- =====================================================================

-- Never the key itself: a pointer into your secret store. A leaked database
-- dump must not be a leaked Kie account.
CREATE TABLE provider_credentials (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_id        uuid NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  label              text NOT NULL,
  secret_ref         text NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  weight             integer NOT NULL DEFAULT 100,   -- round-robin bias
  rpm_limit          integer,
  concurrency_limit  integer,
  last_used_at       timestamptz,
  expires_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, label)
);
CREATE INDEX ON provider_credentials (provider_id) WHERE is_active;

-- Which key served which call — needed to know whose quota you burned
ALTER TABLE job_attempts
  ADD COLUMN credential_id uuid REFERENCES provider_credentials(id);

CREATE TABLE provider_health (
  provider_id          uuid PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  state                text NOT NULL DEFAULT 'up'
                         CHECK (state IN ('up','degraded','down')),
  consecutive_failures integer NOT NULL DEFAULT 0,
  success_rate         numeric(5,4),
  p95_latency_ms       integer,
  opened_at            timestamptz,     -- when the breaker tripped
  retry_after          timestamptz,     -- router skips this provider until then
  last_error           text,
  checked_at           timestamptz NOT NULL DEFAULT now()
);

-- Your estimate vs what the provider actually invoiced. Margin is the
-- business; nothing else catches the estimate quietly drifting.
CREATE TABLE provider_statements (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_id    uuid NOT NULL REFERENCES providers(id),
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  invoiced_usd   numeric(18,6) NOT NULL,
  estimated_usd  numeric(18,6),
  note           text,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, period_start, period_end),
  CHECK (period_end > period_start)
);


-- =====================================================================
--  24. GROWTH — the two credit_lots.source values with no tables behind them
-- =====================================================================

CREATE TABLE promo_codes (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code              citext NOT NULL UNIQUE,
  kind              text NOT NULL DEFAULT 'credits'
                      CHECK (kind IN ('credits','percent_off','free_term')),
  micro_credits     bigint NOT NULL DEFAULT 0,
  percent_off       numeric(5,2) CHECK (percent_off IS NULL OR percent_off BETWEEN 0 AND 100),
  plan_id           uuid REFERENCES plans(id),      -- restrict to one plan, or null for any
  max_redemptions   integer,
  redemption_count  integer NOT NULL DEFAULT 0,
  max_per_account   integer NOT NULL DEFAULT 1,
  starts_at         timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  is_active         boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON promo_codes (expires_at) WHERE is_active;

CREATE TABLE promo_redemptions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  promo_code_id uuid NOT NULL REFERENCES promo_codes(id),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  user_id       uuid REFERENCES users(id),
  order_id      uuid REFERENCES orders(id),
  lot_id        uuid REFERENCES credit_lots(id),
  redeemed_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON promo_redemptions (promo_code_id, account_id);

ALTER TABLE users ADD COLUMN referral_code citext UNIQUE;

CREATE TABLE referrals (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  referrer_user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_user_id      uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  code                  text,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','qualified','rewarded','void')),
  -- qualified = the invitee actually paid; stops referral farming
  reward_micro_credits  bigint NOT NULL DEFAULT 0,
  reward_lot_id         uuid REFERENCES credit_lots(id),
  qualified_at          timestamptz,
  rewarded_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (referrer_user_id <> referred_user_id)
);
CREATE INDEX ON referrals (referrer_user_id, created_at DESC);
CREATE INDEX ON referrals (status) WHERE status IN ('pending','qualified');


-- =====================================================================
--  25. PROGRAMMATIC ACCESS & NOTIFICATION CHOICE
-- =====================================================================

CREATE TABLE api_keys (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_by   uuid REFERENCES users(id),
  name         text NOT NULL,
  key_prefix   text NOT NULL,            -- the visible half, for the UI list
  key_hash     text NOT NULL UNIQUE,     -- the secret half, hashed
  scopes       text[] NOT NULL DEFAULT '{}',
  rpm_limit    integer,
  last_used_at timestamptz,
  expires_at   timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON api_keys (account_id) WHERE revoked_at IS NULL;

-- Absent row = the default in your code. Only stores deviations.
CREATE TABLE notification_preferences (
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type     text NOT NULL,
  channel  text NOT NULL CHECK (channel IN ('in_app','email','push','sms')),
  enabled  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (user_id, type, channel)
);


-- =====================================================================
--  26. COMMENT LIKES
--  post_comments.like_count already promised this table existed.
-- =====================================================================

CREATE TABLE comment_likes (
  comment_id uuid NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);
CREATE INDEX ON comment_likes (user_id, created_at DESC);


-- =====================================================================
--  27. THE COUNTERS schema.sql DECLARED AND NEVER MAINTAINED
--
--  Wired here: posts.comment_count, posts.remix_count,
--  post_comments.like_count, user_profiles.post_count, tags.post_count,
--  conversations.message_count / last_message_at / total_micro_credits.
--
--  Deliberately NOT triggers: posts.view_count and skills.usage_count.
--  Both would write the same hot row on every view and every job, turning
--  one popular preset into a serialization point. usage_daily already
--  rolls up nightly; take those two from there.
-- =====================================================================

CREATE OR REPLACE FUNCTION bump_post_comment_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_comments_counter
  AFTER INSERT OR DELETE ON post_comments
  FOR EACH ROW EXECUTE FUNCTION bump_post_comment_count();

CREATE OR REPLACE FUNCTION bump_comment_like_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE post_comments SET like_count = like_count + 1 WHERE id = NEW.comment_id;
  ELSE
    UPDATE post_comments SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.comment_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER comment_likes_counter
  AFTER INSERT OR DELETE ON comment_likes
  FOR EACH ROW EXECUTE FUNCTION bump_comment_like_count();

CREATE OR REPLACE FUNCTION bump_remix_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.remixed_from_post_id IS NOT NULL THEN
    UPDATE posts SET remix_count = remix_count + 1 WHERE id = NEW.remixed_from_post_id;
  ELSIF TG_OP = 'DELETE' AND OLD.remixed_from_post_id IS NOT NULL THEN
    UPDATE posts SET remix_count = GREATEST(remix_count - 1, 0) WHERE id = OLD.remixed_from_post_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER posts_remix_counter
  AFTER INSERT OR DELETE ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_remix_count();

-- post_count is the PUBLIC count, so it tracks approved-and-not-deleted only
-- and has to follow status transitions in both directions.
CREATE OR REPLACE FUNCTION bump_author_post_count()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  was   boolean := false;
  isnow boolean := false;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    was := (OLD.status = 'approved' AND OLD.deleted_at IS NULL);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    isnow := (NEW.status = 'approved' AND NEW.deleted_at IS NULL);
  END IF;

  IF isnow AND NOT was THEN
    INSERT INTO user_profiles (user_id, post_count) VALUES (NEW.author_user_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET post_count = user_profiles.post_count + 1;
  ELSIF was AND NOT isnow THEN
    UPDATE user_profiles SET post_count = GREATEST(post_count - 1, 0)
      WHERE user_id = OLD.author_user_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER posts_author_counter
  AFTER INSERT OR DELETE OR UPDATE OF status, deleted_at ON posts
  FOR EACH ROW EXECUTE FUNCTION bump_author_post_count();

CREATE OR REPLACE FUNCTION bump_tag_post_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE tags SET post_count = post_count + 1 WHERE id = NEW.tag_id;
  ELSE
    UPDATE tags SET post_count = GREATEST(post_count - 1, 0) WHERE id = OLD.tag_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER post_tags_counter
  AFTER INSERT OR DELETE ON post_tags
  FOR EACH ROW EXECUTE FUNCTION bump_tag_post_count();

CREATE OR REPLACE FUNCTION bump_conversation_stats()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations
       SET message_count = message_count + 1,
           last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
     WHERE id = NEW.conversation_id;
  ELSE
    UPDATE conversations SET message_count = GREATEST(message_count - 1, 0)
     WHERE id = OLD.conversation_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER messages_counter
  AFTER INSERT OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_stats();

-- Usage rows are inserted empty while streaming and updated when the model
-- finishes, so the conversation total moves by the delta, not the value.
CREATE OR REPLACE FUNCTION bump_conversation_spend()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delta bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := NEW.micro_credits_charged;
  ELSIF TG_OP = 'UPDATE' THEN
    delta := NEW.micro_credits_charged - OLD.micro_credits_charged;
  ELSE
    delta := -OLD.micro_credits_charged;
  END IF;

  IF delta <> 0 THEN
    UPDATE conversations c
       SET total_micro_credits = GREATEST(c.total_micro_credits + delta, 0)
      FROM messages m
     WHERE m.id = COALESCE(NEW.message_id, OLD.message_id)
       AND c.id = m.conversation_id;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER message_usage_spend
  AFTER INSERT OR UPDATE OF micro_credits_charged OR DELETE ON message_usage
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_spend();


-- =====================================================================
--  28. updated_at ON THE NEW TABLES
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['plans','subscriptions','provider_credentials'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;


-- =====================================================================
--  29. ADMIN VIEW — revenue in Toman, cost in dollars, one row
-- =====================================================================

CREATE VIEW v_subscription_revenue AS
SELECT
  date_trunc('month', s.starts_at)::date       AS month,
  p.code                                        AS plan,
  count(*)                                      AS terms_sold,
  count(DISTINCT s.account_id)                  AS accounts,
  sum(o.amount)                                 AS revenue_irr,
  sum(o.amount_usd)                             AS revenue_usd,
  sum(s.micro_credits_granted) / 1e6            AS credits_granted,
  count(*) FILTER (WHERE s.status = 'refunded') AS refunded
FROM subscriptions s
JOIN plans p  ON p.id = s.plan_id
LEFT JOIN orders o ON o.id = s.order_id
WHERE s.status <> 'pending'
GROUP BY 1, 2;

COMMIT;
