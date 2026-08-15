-- =====================================================================
--  AI MEDIA GENERATION PLATFORM — POSTGRES SCHEMA
--  Multi-provider (Kie MVP → useapi.net, Fal, Runware, Pixverse)
--  Features: image gen, video gen, multi-model chat w/ RAG, Explore, admin
--
--  Requires: PostgreSQL 15+ (NULLS NOT DISTINCT) with pgvector installed.
--  Apply:    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql
--            (single transaction — a failure rolls the whole thing back)
--
--  Conventions
--    * All PKs are UUIDv7 (time-sortable, safe to expose publicly)
--    * All timestamps are timestamptz, always UTC
--    * Credits are stored as BIGINT micro-credits (1 credit = 1_000_000)
--      -> exact integer math, no floats, sub-credit precision for chat tokens
--    * Provider money is numeric(18,6) USD — never float
--    * Ownership points at accounts, never users (teams later = 1 new row type)
--    * Lookup tables instead of PG enums wherever values will grow
--    * Effective-dated pricing: rows are never UPDATEd, only superseded
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- ---------------------------------------------------------------------
-- UUIDv7 generator (drop this if you are on PG18+, which ships uuidv7())
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuid_generate_v7()
RETURNS uuid
LANGUAGE plpgsql
PARALLEL SAFE
AS $$
DECLARE
  unix_ts_ms bytea;
  uuid_bytes bytea;
BEGIN
  unix_ts_ms := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  uuid_bytes := uuid_send(gen_random_uuid());
  uuid_bytes := overlay(uuid_bytes PLACING unix_ts_ms FROM 1 FOR 6);
  uuid_bytes := set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
  RETURN encode(uuid_bytes, 'hex')::uuid;
END $$;

-- ---------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


-- =====================================================================
--  01. IDENTITY & ACCOUNTS
-- =====================================================================

-- An account is the unit of ownership and the unit of billing.
-- Today every user gets exactly one personal account at signup.
-- Teams later = INSERT accounts(kind='team') + rows in account_members.
CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  kind            text NOT NULL DEFAULT 'personal'
                    CHECK (kind IN ('personal','team')),
  display_name    text,
  owner_user_id   uuid,                       -- FK added after users exists
  status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active','suspended','closed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE users (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  email               citext UNIQUE,
  email_verified_at   timestamptz,
  phone               text UNIQUE,            -- E.164; primary login in many markets
  phone_verified_at   timestamptz,
  password_hash       text,                   -- null = OAuth/OTP only
  handle              citext UNIQUE,          -- public @handle for profiles
  display_name        text,
  avatar_asset_id     uuid,                   -- FK added after assets exists
  locale              text NOT NULL DEFAULT 'en',
  timezone            text NOT NULL DEFAULT 'UTC',
  personal_account_id uuid REFERENCES accounts(id),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','banned','deleted')),
  last_seen_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CHECK (email IS NOT NULL OR phone IS NOT NULL)
);

ALTER TABLE accounts
  ADD CONSTRAINT accounts_owner_fk
  FOREIGN KEY (owner_user_id) REFERENCES users(id);

CREATE INDEX ON users (created_at DESC);
-- gin_trgm_ops has no citext variant; index the text projection instead.
-- Queries must match the expression: WHERE handle::text ILIKE '%foo%'
CREATE INDEX users_handle_trgm ON users USING gin ((handle::text) gin_trgm_ops);

CREATE TABLE account_members (
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner','admin','member','viewer')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, user_id)
);
CREATE INDEX ON account_members (user_id);

-- Platform-level roles (admin panel access), separate from account roles
CREATE TABLE roles (
  code        text PRIMARY KEY,               -- 'admin','moderator','support','user'
  name        text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code   text NOT NULL REFERENCES roles(code),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_code)
);

CREATE TABLE auth_identities (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,                -- 'google','github','apple','otp'
  provider_uid  text NOT NULL,
  email         citext,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_uid)
);
CREATE INDEX ON auth_identities (user_id);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,         -- store the hash, never the token
  ip            inet,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);
CREATE INDEX ON sessions (user_id) WHERE revoked_at IS NULL;

-- Public-facing profile (Explore)
CREATE TABLE user_profiles (
  user_id         uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio             text,
  links           jsonb NOT NULL DEFAULT '{}'::jsonb,
  cover_asset_id  uuid,
  is_public       boolean NOT NULL DEFAULT true,
  follower_count  integer NOT NULL DEFAULT 0,   -- denormalized, trigger-maintained
  following_count integer NOT NULL DEFAULT 0,
  post_count      integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
--  02. PROVIDERS, MODELS & PRICING
--  The app never names "Kie". It asks for a feature; the router picks
--  a model; pricing resolves through effective-dated rows.
-- =====================================================================

CREATE TABLE providers (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code              text NOT NULL UNIQUE,     -- 'kie','useapi','fal','runware','pixverse'
  name              text NOT NULL,
  base_url          text,
  credit_unit_name  text NOT NULL DEFAULT 'credit', -- what THEY call their unit
  is_async          boolean NOT NULL DEFAULT true,  -- webhook/poll vs sync response
  supports_webhook  boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  config            jsonb NOT NULL DEFAULT '{}'::jsonb, -- non-secret config only
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Features = the sections of your product
CREATE TABLE features (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code        text NOT NULL UNIQUE,           -- 'image_generate','image_edit',
                                              -- 'video_generate','image_to_video','chat'
  name        text NOT NULL,
  modality    text NOT NULL CHECK (modality IN ('image','video','audio','text')),
  description text,
  icon        text,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- LLMs live here too (modality='text') so chat shares pricing + ledger
CREATE TABLE provider_models (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_id        uuid NOT NULL REFERENCES providers(id),
  external_model_id  text NOT NULL,           -- exact string the provider expects
  name               text NOT NULL,           -- what the user sees
  modality           text NOT NULL CHECK (modality IN ('image','video','audio','text')),
  family             text,                    -- 'gpt','claude','qwen','kimi','veo','flux'
  capabilities       jsonb NOT NULL DEFAULT '{}'::jsonb,
     -- e.g. {"max_duration_s":10,"aspect_ratios":["16:9","9:16"],
     --       "image_input":true,"vision":true,"tools":true,"context_window":200000}
  params_schema      jsonb NOT NULL DEFAULT '{}'::jsonb, -- JSON Schema, drives the UI form
  default_params     jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active          boolean NOT NULL DEFAULT true,
  deprecated_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, external_model_id)
);
CREATE INDEX ON provider_models (modality) WHERE is_active;

-- Which models can serve which feature, and in what order the router tries them
CREATE TABLE feature_model_routes (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  feature_id         uuid NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  provider_model_id  uuid NOT NULL REFERENCES provider_models(id),
  priority           integer NOT NULL DEFAULT 100,  -- lower = tried first
  is_default         boolean NOT NULL DEFAULT false,
  is_fallback        boolean NOT NULL DEFAULT false,
  is_active          boolean NOT NULL DEFAULT true,
  param_overrides    jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (feature_id, provider_model_id)
);
CREATE UNIQUE INDEX ON feature_model_routes (feature_id)
  WHERE is_default AND is_active;

-- LAYER 1: how much is 1 unit of THEIR credit worth in YOUR credits.
-- Effective-dated. Never UPDATE — insert a new row and close the old one.
CREATE TABLE provider_credit_rates (
  id                     uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_id            uuid NOT NULL REFERENCES providers(id),
  provider_unit_cost_usd numeric(18,6) NOT NULL,  -- what 1 of their credits costs you
  micro_credits_per_unit bigint NOT NULL,         -- your credits per 1 of their units
  note                   text,
  valid_from             timestamptz NOT NULL DEFAULT now(),
  valid_to               timestamptz,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON provider_credit_rates (provider_id, valid_from DESC);
-- one open rate per provider at a time
CREATE UNIQUE INDEX ON provider_credit_rates (provider_id) WHERE valid_to IS NULL;

-- LAYER 2: the price of one generation, in YOUR credits.
-- pricing_mode 'derived' = compute from provider units * rate * margin
-- pricing_mode 'fixed'   = you typed a number in the admin panel; use it verbatim
CREATE TABLE model_prices (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_model_id     uuid NOT NULL REFERENCES provider_models(id),
  feature_id            uuid REFERENCES features(id),   -- null = any feature
  pricing_mode          text NOT NULL DEFAULT 'fixed'
                          CHECK (pricing_mode IN ('fixed','derived')),
  -- cost side (what the provider charges you)
  provider_units_base   numeric(18,6) NOT NULL DEFAULT 0,
  provider_units_per_second      numeric(18,6) NOT NULL DEFAULT 0,
  provider_units_per_megapixel   numeric(18,6) NOT NULL DEFAULT 0,
  provider_units_per_1k_input_tokens   numeric(18,6) NOT NULL DEFAULT 0,
  provider_units_per_1k_output_tokens  numeric(18,6) NOT NULL DEFAULT 0,
  -- price side (what you charge the user, in micro-credits)
  micro_credits_base            bigint NOT NULL DEFAULT 0,
  micro_credits_per_second      bigint NOT NULL DEFAULT 0,
  micro_credits_per_megapixel   bigint NOT NULL DEFAULT 0,
  micro_credits_per_1k_input_tokens   bigint NOT NULL DEFAULT 0,
  micro_credits_per_1k_output_tokens  bigint NOT NULL DEFAULT 0,
  margin_pct            numeric(6,2) NOT NULL DEFAULT 0,  -- used when derived
  min_micro_credits     bigint NOT NULL DEFAULT 0,
  valid_from            timestamptz NOT NULL DEFAULT now(),
  valid_to              timestamptz,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON model_prices (provider_model_id, feature_id, valid_from DESC);


-- =====================================================================
--  03. WALLET, CREDIT PACKS & LEDGER
--  credit_ledger is APPEND-ONLY and is the single source of truth.
--  account_balances is a cache; reconcile it against SUM(ledger) nightly.
--  Two-phase: hold on submit -> capture on success / release on failure.
-- =====================================================================

CREATE TABLE credit_packages (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code           text NOT NULL UNIQUE,
  name           text NOT NULL,
  micro_credits  bigint NOT NULL,
  bonus_micro_credits bigint NOT NULL DEFAULT 0,
  price_amount   numeric(12,2) NOT NULL,
  currency       text NOT NULL DEFAULT 'USD',
  validity_days  integer,                  -- null = never expires
  is_active      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id     uuid NOT NULL REFERENCES accounts(id),
  user_id        uuid NOT NULL REFERENCES users(id),
  package_id     uuid REFERENCES credit_packages(id),
  micro_credits  bigint NOT NULL,
  amount         numeric(12,2) NOT NULL,
  currency       text NOT NULL,
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON orders (account_id, created_at DESC);

CREATE TABLE payments (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  order_id       uuid NOT NULL REFERENCES orders(id),
  gateway        text NOT NULL,             -- 'stripe','zarinpal','crypto','manual'
  external_ref   text,                      -- gateway transaction id
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','authorized','captured','failed','refunded')),
  amount         numeric(12,2) NOT NULL,
  currency       text NOT NULL,
  raw_payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  paid_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, external_ref)
);

-- Lots let you expire credits FIFO later without rewriting the ledger.
CREATE TABLE credit_lots (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id            uuid NOT NULL REFERENCES accounts(id),
  source                text NOT NULL
                          CHECK (source IN ('purchase','signup_bonus','promo','admin_grant','refund','referral')),
  order_id              uuid REFERENCES orders(id),
  micro_credits_total   bigint NOT NULL,
  micro_credits_remaining bigint NOT NULL,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (micro_credits_remaining >= 0),
  CHECK (micro_credits_remaining <= micro_credits_total)
);
CREATE INDEX ON credit_lots (account_id, expires_at NULLS LAST)
  WHERE micro_credits_remaining > 0;

CREATE TABLE credit_ledger (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  lot_id            uuid REFERENCES credit_lots(id),
  entry_type        text NOT NULL CHECK (entry_type IN
                      ('purchase','grant','hold','capture','release',
                       'refund','expiry','adjustment')),
  micro_credits     bigint NOT NULL,          -- signed: + adds, - removes
  balance_after     bigint NOT NULL,          -- running balance snapshot
  ref_type          text,                     -- 'job','message','order','post'
  ref_id            uuid,
  note              text,
  created_by        uuid REFERENCES users(id),-- set for admin adjustments
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON credit_ledger (account_id, created_at DESC);
CREATE INDEX ON credit_ledger (ref_type, ref_id);
CREATE INDEX ON credit_ledger (entry_type, created_at DESC);
-- ledger is append-only: enforce it
CREATE RULE credit_ledger_no_update AS ON UPDATE TO credit_ledger DO INSTEAD NOTHING;
CREATE RULE credit_ledger_no_delete AS ON DELETE TO credit_ledger DO INSTEAD NOTHING;

CREATE TABLE credit_holds (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id     uuid NOT NULL REFERENCES accounts(id),
  ref_type       text NOT NULL,               -- 'job' | 'message'
  ref_id         uuid NOT NULL,
  micro_credits  bigint NOT NULL CHECK (micro_credits > 0),
  status         text NOT NULL DEFAULT 'held'
                   CHECK (status IN ('held','captured','released','expired')),
  captured_micro_credits bigint,              -- actual charge may be < hold
  expires_at     timestamptz NOT NULL DEFAULT now() + interval '1 hour',
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE UNIQUE INDEX ON credit_holds (ref_type, ref_id) WHERE status = 'held';
CREATE INDEX ON credit_holds (account_id) WHERE status = 'held';

-- Cache. Truth = credit_ledger. Reconcile on a schedule.
CREATE TABLE account_balances (
  account_id            uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  micro_credits         bigint NOT NULL DEFAULT 0,
  held_micro_credits    bigint NOT NULL DEFAULT 0,
  lifetime_purchased    bigint NOT NULL DEFAULT 0,
  lifetime_spent        bigint NOT NULL DEFAULT 0,
  last_reconciled_at    timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (micro_credits >= 0),
  CHECK (held_micro_credits >= 0)
);

-- Spend guardrails (per account, tunable from the admin panel)
CREATE TABLE account_limits (
  account_id           uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  max_concurrent_jobs  integer NOT NULL DEFAULT 3,
  daily_job_cap        integer,
  daily_micro_credit_cap bigint,
  allow_nsfw           boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
--  04. SKILLS (cinematic, etc.) — VERSIONED, NEVER MUTATED
--  Jobs reference skill_version_id, so editing the cinematic prompt
--  tomorrow does not rewrite what yesterday's generations actually used.
-- =====================================================================

CREATE TABLE skills (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  feature_id          uuid NOT NULL REFERENCES features(id),
  code                text NOT NULL UNIQUE,   -- 'cinematic','anime','product_shot'
  name                text NOT NULL,
  description         text,
  cover_asset_id      uuid,
  category            text,
  is_active           boolean NOT NULL DEFAULT true,
  is_premium          boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0,
  usage_count         bigint NOT NULL DEFAULT 0,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON skills (feature_id) WHERE is_active;

CREATE TABLE skill_versions (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  skill_id            uuid NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  version             integer NOT NULL,
  system_prompt       text,                   -- the cinematic system prompt
  prompt_template     text,                   -- e.g. '{user_prompt}, cinematic lighting, 35mm'
  negative_prompt     text,
  default_params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  param_schema        jsonb NOT NULL DEFAULT '{}'::jsonb,  -- JSON Schema -> renders the UI
  preferred_model_id  uuid REFERENCES provider_models(id),
  price_multiplier    numeric(6,3) NOT NULL DEFAULT 1.0,
  changelog           text,
  is_published        boolean NOT NULL DEFAULT false,
  published_at        timestamptz,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (skill_id, version)
);
CREATE UNIQUE INDEX ON skill_versions (skill_id) WHERE is_published;


-- =====================================================================
--  05. ASSETS & RAG
--  ONE table for uploads and generations. origin tells them apart.
--  This is what makes img2img / img2video / video2video schema-free.
-- =====================================================================

CREATE TABLE assets (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id        uuid REFERENCES accounts(id),   -- null = system asset
  created_by        uuid REFERENCES users(id),
  kind              text NOT NULL CHECK (kind IN ('image','video','audio','document')),
  origin            text NOT NULL CHECK (origin IN ('upload','generated','system','derived')),
  job_id            uuid,                    -- FK added after jobs exists
  output_index      integer,                 -- position within a batch of N outputs
  storage_provider  text NOT NULL DEFAULT 's3',
  storage_bucket    text NOT NULL,
  storage_key       text NOT NULL,
  public_url        text,
  mime_type         text NOT NULL,
  byte_size         bigint,
  width             integer,
  height            integer,
  duration_ms       integer,
  frame_rate        numeric(6,3),
  page_count        integer,                 -- documents
  sha256            text,                    -- dedupe re-uploads
  thumbnail_asset_id uuid REFERENCES assets(id),
  moderation_state  text NOT NULL DEFAULT 'pending'
                      CHECK (moderation_state IN
                        ('pending','scanning','approved','flagged','rejected')),
  visibility        text NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','unlisted','public')),
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at        timestamptz,             -- retention / auto-purge
  created_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,
  UNIQUE (storage_bucket, storage_key)
);
CREATE INDEX ON assets (account_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON assets (job_id);
CREATE INDEX ON assets (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX ON assets (moderation_state) WHERE moderation_state IN ('pending','flagged');
CREATE INDEX ON assets (expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE users
  ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_asset_id) REFERENCES assets(id);

-- Parsed text from an uploaded PDF/doc
CREATE TABLE document_extractions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  asset_id      uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','ready','failed')),
  extractor     text,                        -- 'pdfplumber','unstructured','ocr'
  page_count    integer,
  char_count    integer,
  content       text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
CREATE INDEX ON document_extractions (asset_id);

-- RAG chunks. Fixed at 1536 dims — if you mix embedding models with
-- different dimensions, add a parallel table rather than a nullable column.
CREATE TABLE document_chunks (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  extraction_id   uuid REFERENCES document_extractions(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id),  -- denormalized for filtering
  chunk_index     integer NOT NULL,
  content         text NOT NULL,
  token_count     integer,
  page_from       integer,
  page_to         integer,
  embedding       vector(1536),
  embedding_model text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (asset_id, chunk_index)
);
CREATE INDEX ON document_chunks (account_id);
CREATE INDEX document_chunks_embedding_idx ON document_chunks
  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX document_chunks_content_trgm ON document_chunks
  USING gin (content gin_trgm_ops);          -- hybrid keyword + vector search


-- =====================================================================
--  06. JOBS — base table + per-modality detail
--  jobs holds everything billing/status/audit cares about.
--  job_attempts holds one row per actual provider call (retries, failover).
-- =====================================================================

CREATE TABLE jobs (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id            uuid NOT NULL REFERENCES accounts(id),
  created_by            uuid NOT NULL REFERENCES users(id),
  feature_id            uuid NOT NULL REFERENCES features(id),
  skill_version_id      uuid REFERENCES skill_versions(id),
  provider_model_id     uuid REFERENCES provider_models(id),   -- resolved by router
  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('draft','queued','running','succeeded',
                                            'failed','cancelled','expired')),
  origin                text NOT NULL DEFAULT 'web'
                          CHECK (origin IN ('web','chat','api','remix','admin')),
  origin_message_id     uuid,                 -- set when chat triggered it
  parent_job_id         uuid REFERENCES jobs(id),  -- remix / variation lineage
  idempotency_key       text,
  -- the fully resolved params actually sent (after skill + defaults + user input)
  params                jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- billing snapshot: frozen at submit time, never recomputed
  micro_credits_held    bigint NOT NULL DEFAULT 0,
  micro_credits_charged bigint NOT NULL DEFAULT 0,
  price_id              uuid REFERENCES model_prices(id),
  price_snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_units_cost   numeric(18,6),
  provider_cost_usd     numeric(18,6),
  output_count          integer NOT NULL DEFAULT 0,
  attempt_count         integer NOT NULL DEFAULT 0,
  priority              integer NOT NULL DEFAULT 100,
  error_code            text,
  error_message         text,
  queued_at             timestamptz NOT NULL DEFAULT now(),
  started_at            timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE UNIQUE INDEX ON jobs (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ON jobs (account_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX ON jobs (status, priority, queued_at) WHERE status IN ('queued','running');
CREATE INDEX ON jobs (feature_id, created_at DESC);
CREATE INDEX ON jobs (provider_model_id, created_at DESC);
CREATE INDEX jobs_params_gin ON jobs USING gin (params jsonb_path_ops);

ALTER TABLE assets ADD CONSTRAINT assets_job_fk
  FOREIGN KEY (job_id) REFERENCES jobs(id);

CREATE TABLE image_jobs (
  job_id          uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  prompt          text,
  negative_prompt text,
  aspect_ratio    text,
  width           integer,
  height          integer,
  steps           integer,
  guidance_scale  numeric(6,2),
  seed            bigint,
  num_outputs     integer NOT NULL DEFAULT 1,
  strength        numeric(4,3),               -- img2img denoise strength
  style           text
);

CREATE TABLE video_jobs (
  job_id           uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  prompt           text,
  negative_prompt  text,
  duration_seconds numeric(6,2),
  fps              integer,
  resolution       text,                      -- '720p','1080p','4k'
  aspect_ratio     text,
  motion_preset    text,                      -- the Higgsfield-style motion pack
  camera_movement  text,
  motion_strength  numeric(4,3),
  seed             bigint,
  with_audio       boolean NOT NULL DEFAULT false,
  loop             boolean NOT NULL DEFAULT false
);

-- Inputs: covers img2img, img2video, video2video, multi-reference, inpainting.
-- Adding a new input mode later needs zero schema change.
CREATE TABLE job_inputs (
  job_id    uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  asset_id  uuid NOT NULL REFERENCES assets(id),
  role      text NOT NULL CHECK (role IN
              ('source','reference','mask','style','first_frame','last_frame','audio')),
  position  integer NOT NULL DEFAULT 0,
  weight    numeric(4,3),
  PRIMARY KEY (job_id, asset_id, role, position)
);
CREATE INDEX ON job_inputs (asset_id);

-- One row per provider call. Retries and cross-provider failover both live here.
CREATE TABLE job_attempts (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  job_id             uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  attempt_no         integer NOT NULL,
  provider_id        uuid NOT NULL REFERENCES providers(id),
  provider_model_id  uuid NOT NULL REFERENCES provider_models(id),
  external_job_id    text,                    -- their task id, for webhook matching
  endpoint           text,
  request_payload    jsonb,                   -- exact bytes you sent: reproducibility
  response_payload   jsonb,
  http_status        integer,
  status             text NOT NULL DEFAULT 'sent'
                       CHECK (status IN ('sent','polling','succeeded','failed','timeout','cancelled')),
  provider_units_cost numeric(18,6),
  latency_ms         integer,
  error_code         text,
  error_message      text,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  UNIQUE (job_id, attempt_no)
);
CREATE INDEX ON job_attempts (provider_id, external_job_id);
CREATE INDEX ON job_attempts (job_id);

-- Provider callbacks land here first, deduped, then get processed.
CREATE TABLE provider_webhook_events (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  provider_id       uuid NOT NULL REFERENCES providers(id),
  external_event_id text,
  external_job_id   text,
  event_type        text,
  signature_valid   boolean,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  process_error     text,
  UNIQUE (provider_id, external_event_id)
);
CREATE INDEX ON provider_webhook_events (processed_at) WHERE processed_at IS NULL;
CREATE INDEX ON provider_webhook_events (provider_id, external_job_id);


-- =====================================================================
--  07. CHAT (multi-model: GPT / Claude / Kimi / Qwen / ...)
-- =====================================================================

CREATE TABLE conversations (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id         uuid NOT NULL REFERENCES accounts(id),
  user_id            uuid NOT NULL REFERENCES users(id),
  title              text,
  default_model_id   uuid REFERENCES provider_models(id),
  skill_version_id   uuid REFERENCES skill_versions(id),
  system_prompt_override text,
  settings           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- temperature, tools enabled…
  is_pinned          boolean NOT NULL DEFAULT false,
  is_archived        boolean NOT NULL DEFAULT false,
  message_count      integer NOT NULL DEFAULT 0,
  total_micro_credits bigint NOT NULL DEFAULT 0,
  last_message_at    timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz
);
CREATE INDEX ON conversations (user_id, last_message_at DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE TABLE messages (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  parent_message_id uuid REFERENCES messages(id),   -- branching / regenerate
  role              text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  provider_model_id uuid REFERENCES provider_models(id),
  status            text NOT NULL DEFAULT 'complete'
                      CHECK (status IN ('streaming','complete','failed','cancelled')),
  finish_reason     text,
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON messages (conversation_id, created_at);

-- Multimodal content. One message = N ordered parts.
CREATE TABLE message_parts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  position     integer NOT NULL,
  type         text NOT NULL CHECK (type IN
                 ('text','image','file','tool_call','tool_result','reasoning','citation')),
  text_content text,
  asset_id     uuid REFERENCES assets(id),
  tool_name    text,
  tool_call_id text,
  tool_input   jsonb,
  tool_result  jsonb,
  job_id       uuid REFERENCES jobs(id),      -- chat-triggered generation
  UNIQUE (message_id, position)
);
CREATE INDEX ON message_parts (asset_id);
CREATE INDEX ON message_parts (job_id);

-- SET NULL, not RESTRICT: deleting a conversation cascades to its messages,
-- which must not be blocked by a job still pointing back at one.
ALTER TABLE jobs ADD CONSTRAINT jobs_origin_message_fk
  FOREIGN KEY (origin_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE message_usage (
  message_id           uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  input_tokens         integer NOT NULL DEFAULT 0,
  cached_input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens        integer NOT NULL DEFAULT 0,
  reasoning_tokens     integer NOT NULL DEFAULT 0,
  provider_cost_usd    numeric(18,6),
  micro_credits_charged bigint NOT NULL DEFAULT 0,
  price_id             uuid REFERENCES model_prices(id),
  latency_ms           integer
);

-- Documents attached to a conversation and available for retrieval
CREATE TABLE conversation_documents (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  asset_id        uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, asset_id)
);

-- Which chunks were actually retrieved for a given answer (debuggability)
CREATE TABLE message_retrievals (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  chunk_id   uuid NOT NULL REFERENCES document_chunks(id) ON DELETE CASCADE,
  score      real,
  rank       integer
);
CREATE INDEX ON message_retrievals (message_id);


-- =====================================================================
--  08. EXPLORE (posts, likes, comments, follows, tags, collections)
-- =====================================================================

CREATE TABLE posts (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id          uuid NOT NULL REFERENCES accounts(id),
  author_user_id      uuid NOT NULL REFERENCES users(id),
  job_id              uuid REFERENCES jobs(id),
  cover_asset_id      uuid REFERENCES assets(id),
  remixed_from_post_id uuid REFERENCES posts(id),
  title               text,
  caption             text,
  prompt_visible      boolean NOT NULL DEFAULT true,  -- share the recipe or not
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('draft','pending','approved','rejected','removed')),
  rejection_reason    text,
  is_featured         boolean NOT NULL DEFAULT false,
  like_count          integer NOT NULL DEFAULT 0,
  comment_count       integer NOT NULL DEFAULT 0,
  view_count          bigint NOT NULL DEFAULT 0,
  remix_count         integer NOT NULL DEFAULT 0,
  submitted_at        timestamptz,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);
CREATE INDEX ON posts (status, submitted_at) WHERE status = 'pending';
CREATE INDEX ON posts (published_at DESC) WHERE status = 'approved' AND deleted_at IS NULL;
CREATE INDEX ON posts (author_user_id, created_at DESC);
CREATE INDEX ON posts (like_count DESC, published_at DESC) WHERE status = 'approved';

CREATE TABLE post_assets (
  post_id   uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id  uuid NOT NULL REFERENCES assets(id),
  position  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, asset_id)
);

-- Full review history, not a single mutable status column
CREATE TABLE post_reviews (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  post_id          uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  reviewer_user_id uuid REFERENCES users(id),
  decision         text NOT NULL CHECK (decision IN ('approved','rejected','escalated')),
  reason_code      text,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON post_reviews (post_id, created_at DESC);

CREATE TABLE post_likes (
  post_id    uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX ON post_likes (user_id, created_at DESC);

CREATE TABLE post_comments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  post_id           uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id),
  parent_comment_id uuid REFERENCES post_comments(id),
  body              text NOT NULL,
  status            text NOT NULL DEFAULT 'visible'
                      CHECK (status IN ('visible','pending','hidden','removed')),
  like_count        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz
);
CREATE INDEX ON post_comments (post_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE follows (
  follower_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_user_id, followee_user_id),
  CHECK (follower_user_id <> followee_user_id)
);
CREATE INDEX ON follows (followee_user_id, created_at DESC);

CREATE TABLE tags (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       citext NOT NULL UNIQUE,
  name       text NOT NULL,
  post_count integer NOT NULL DEFAULT 0
);

CREATE TABLE post_tags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id  uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX ON post_tags (tag_id);

CREATE TABLE collections (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  is_public  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE collection_items (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id       uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, post_id)
);


-- =====================================================================
--  09. MODERATION
--  Flow you described:
--    upload -> auto scan -> pass: continue
--                        -> flag: moderation_items(pending_review)
--                                 + notification to the user
--                                 + admin panel queue
--  One generic queue for assets, posts, comments and profiles.
-- =====================================================================

CREATE TABLE moderation_scans (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  target_type  text NOT NULL CHECK (target_type IN ('asset','post','comment','profile','prompt')),
  target_id    uuid NOT NULL,
  scanner      text NOT NULL,                 -- 'openai_moderation','hive','aws_rekognition'
  scanner_version text,
  verdict      text NOT NULL CHECK (verdict IN ('pass','flag','block','error')),
  categories   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"nsfw":true,"violence":false}
  scores       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"nsfw":0.94,...}
  raw_response jsonb,
  latency_ms   integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON moderation_scans (target_type, target_id, created_at DESC);

CREATE TABLE moderation_items (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  target_type      text NOT NULL CHECK (target_type IN ('asset','post','comment','profile')),
  target_id        uuid NOT NULL,
  account_id       uuid REFERENCES accounts(id),
  scan_id          uuid REFERENCES moderation_scans(id),
  trigger          text NOT NULL DEFAULT 'auto_scan'
                     CHECK (trigger IN ('auto_scan','user_report','manual','publish_request')),
  state            text NOT NULL DEFAULT 'pending_review'
                     CHECK (state IN ('auto_approved','pending_review','in_review',
                                      'approved','rejected','escalated')),
  severity         text CHECK (severity IN ('low','medium','high','critical')),
  reason_codes     text[] NOT NULL DEFAULT '{}',
  assigned_to      uuid REFERENCES users(id),
  resolved_by      uuid REFERENCES users(id),
  resolution_note  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);
-- At most one OPEN item per target. (The original UNIQUE on created_at was a
-- no-op: now() is the transaction timestamp, so it never caught a real dupe.)
CREATE UNIQUE INDEX moderation_items_one_open_per_target
  ON moderation_items (target_type, target_id)
  WHERE state IN ('pending_review','in_review','escalated');
CREATE INDEX ON moderation_items (state, severity, created_at)
  WHERE state IN ('pending_review','in_review','escalated');
CREATE INDEX ON moderation_items (target_type, target_id);
CREATE INDEX ON moderation_items (assigned_to) WHERE state = 'in_review';

CREATE TABLE moderation_actions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  item_id        uuid REFERENCES moderation_items(id) ON DELETE CASCADE,
  actor_user_id  uuid REFERENCES users(id),
  action         text NOT NULL,               -- 'approve','reject','remove','ban_user','warn'
  reason_code    text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON moderation_actions (item_id, created_at);

CREATE TABLE reports (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  reporter_user_id  uuid NOT NULL REFERENCES users(id),
  target_type       text NOT NULL CHECK (target_type IN ('post','comment','user','asset')),
  target_id         uuid NOT NULL,
  reason_code       text NOT NULL,
  details           text,
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','reviewing','actioned','dismissed')),
  moderation_item_id uuid REFERENCES moderation_items(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  UNIQUE (reporter_user_id, target_type, target_id)
);
CREATE INDEX ON reports (status, created_at) WHERE status = 'open';

CREATE TABLE bans (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope       text NOT NULL DEFAULT 'platform'
                CHECK (scope IN ('platform','explore','comments','generation')),
  reason      text,
  created_by  uuid REFERENCES users(id),
  expires_at  timestamptz,                    -- null = permanent
  created_at  timestamptz NOT NULL DEFAULT now(),
  lifted_at   timestamptz
);
CREATE INDEX ON bans (user_id) WHERE lifted_at IS NULL;


-- =====================================================================
--  10. NOTIFICATIONS
-- =====================================================================

CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       text NOT NULL,   -- 'job_ready','post_approved','post_pending_review',
                              -- 'post_rejected','low_balance','new_follower','new_like'
  title      text NOT NULL,
  body       text,
  data       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {"post_id":"…","job_id":"…"}
  channel    text NOT NULL DEFAULT 'in_app'
               CHECK (channel IN ('in_app','email','push','sms')),
  read_at    timestamptz,
  sent_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON notifications (user_id, created_at DESC);
CREATE INDEX ON notifications (user_id) WHERE read_at IS NULL;


-- =====================================================================
--  11. ADMIN, ANALYTICS & OPS
-- =====================================================================

-- Every admin action. Non-negotiable once someone can edit prompts,
-- grant credits, or approve content.
CREATE TABLE audit_log (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_user_id  uuid REFERENCES users(id),
  actor_role     text,
  action         text NOT NULL,               -- 'skill_version.publish','credits.grant'
  target_type    text,
  target_id      uuid,
  before_state   jsonb,
  after_state    jsonb,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (actor_user_id, created_at DESC);
CREATE INDEX ON audit_log (target_type, target_id, created_at DESC);
CREATE INDEX ON audit_log (action, created_at DESC);

CREATE TABLE feature_flags (
  code        text PRIMARY KEY,
  description text,
  is_enabled  boolean NOT NULL DEFAULT false,
  rollout_pct integer NOT NULL DEFAULT 0 CHECK (rollout_pct BETWEEN 0 AND 100),
  rules       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Raw event stream. Partition monthly; drop old partitions instead of DELETE.
CREATE TABLE events (
  id          uuid NOT NULL DEFAULT uuid_generate_v7(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  account_id  uuid,
  user_id     uuid,
  session_id  uuid,
  name        text NOT NULL,       -- 'job.submitted','post.viewed','credits.purchased'
  properties  jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE INDEX ON events (name, occurred_at DESC);
CREATE INDEX ON events (user_id, occurred_at DESC);

-- Rolling 14 months of partitions, created up front. ensure_event_partitions()
-- below is idempotent — run it from cron; it tops the window back up.
CREATE OR REPLACE FUNCTION ensure_event_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m date;
BEGIN
  FOR m IN
    SELECT generate_series(date_trunc('month', now() - interval '1 month'),
                           date_trunc('month', now()) + (months_ahead || ' months')::interval,
                           interval '1 month')::date
  LOOP
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF events FOR VALUES FROM (%L) TO (%L)',
      'events_' || to_char(m, 'YYYY_MM'), m, m + interval '1 month');
  END LOOP;
END $$;

SELECT ensure_event_partitions(12);

-- Nightly rollup. The admin dashboard reads THIS, never the raw ledger.
CREATE TABLE usage_daily (
  day                   date NOT NULL,
  account_id            uuid NOT NULL REFERENCES accounts(id),
  feature_id            uuid REFERENCES features(id),
  provider_model_id     uuid REFERENCES provider_models(id),
  job_count             integer NOT NULL DEFAULT 0,
  success_count         integer NOT NULL DEFAULT 0,
  failure_count         integer NOT NULL DEFAULT 0,
  micro_credits_charged bigint NOT NULL DEFAULT 0,
  provider_cost_usd     numeric(18,6) NOT NULL DEFAULT 0,
  input_tokens          bigint NOT NULL DEFAULT 0,
  output_tokens         bigint NOT NULL DEFAULT 0,
  output_assets         integer NOT NULL DEFAULT 0
);
-- Not a PRIMARY KEY: a PK would force NOT NULL onto feature_id and
-- provider_model_id, killing the "all features / all models" rollup rows.
-- NULLS NOT DISTINCT (PG15+) still makes ON CONFLICT upserts work.
CREATE UNIQUE INDEX usage_daily_key ON usage_daily
  (day, account_id, feature_id, provider_model_id) NULLS NOT DISTINCT;
CREATE INDEX ON usage_daily (day DESC);
CREATE INDEX ON usage_daily (account_id, day DESC);

-- Reliable side effects (send notification, kick off scan, publish post)
CREATE TABLE outbox (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  available_at  timestamptz NOT NULL DEFAULT now(),
  attempts      integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  last_error    text,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox (available_at) WHERE processed_at IS NULL;


-- =====================================================================
--  12. TRIGGERS
-- =====================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts','users','providers','provider_models','skills','jobs',
    'conversations','posts','post_comments','credit_packages','orders'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

-- Denormalized counters
CREATE OR REPLACE FUNCTION bump_post_like_count()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
  ELSE
    UPDATE posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER post_likes_counter
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION bump_post_like_count();

-- Upsert on increment: a user_profiles row may not exist yet, and a plain
-- UPDATE would silently drop the count instead of erroring.
CREATE OR REPLACE FUNCTION bump_follow_counts()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO user_profiles (user_id, follower_count) VALUES (NEW.followee_user_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET follower_count = user_profiles.follower_count + 1;
    INSERT INTO user_profiles (user_id, following_count) VALUES (NEW.follower_user_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET following_count = user_profiles.following_count + 1;
  ELSE
    UPDATE user_profiles SET follower_count = GREATEST(follower_count - 1, 0)
      WHERE user_id = OLD.followee_user_id;
    UPDATE user_profiles SET following_count = GREATEST(following_count - 1, 0)
      WHERE user_id = OLD.follower_user_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER follows_counter
  AFTER INSERT OR DELETE ON follows
  FOR EACH ROW EXECUTE FUNCTION bump_follow_counts();


-- =====================================================================
--  13. HELPER VIEWS FOR THE ADMIN PANEL
-- =====================================================================

-- Per-user spend + your actual margin
CREATE VIEW v_user_spend AS
SELECT
  u.id                                    AS user_id,
  u.handle,
  u.email,
  a.id                                    AS account_id,
  b.micro_credits / 1e6                   AS balance_credits,
  b.lifetime_purchased / 1e6              AS purchased_credits,
  b.lifetime_spent / 1e6                  AS spent_credits,
  COALESCE(j.job_count, 0)                AS total_jobs,
  COALESCE(j.provider_cost_usd, 0)        AS provider_cost_usd,
  COALESCE(m.message_count, 0)            AS chat_messages,
  COALESCE(m.tokens_in, 0)                AS tokens_in,
  COALESCE(m.tokens_out, 0)               AS tokens_out
FROM users u
JOIN accounts a          ON a.id = u.personal_account_id
LEFT JOIN account_balances b ON b.account_id = a.id
LEFT JOIN LATERAL (
  SELECT count(*) AS job_count, sum(provider_cost_usd) AS provider_cost_usd
  FROM jobs WHERE account_id = a.id AND status = 'succeeded'
) j ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS message_count,
         sum(mu.input_tokens) AS tokens_in,
         sum(mu.output_tokens) AS tokens_out
  FROM messages ms
  JOIN conversations c ON c.id = ms.conversation_id
  JOIN message_usage mu ON mu.message_id = ms.id
  WHERE c.account_id = a.id
) m ON true;

-- The admin moderation queue, one list for every content type
CREATE VIEW v_moderation_queue AS
SELECT
  mi.id, mi.target_type, mi.target_id, mi.state, mi.severity,
  mi.reason_codes, mi.created_at, mi.assigned_to,
  ms.verdict AS scan_verdict, ms.scores AS scan_scores,
  a.storage_key, a.mime_type, a.kind,
  u.handle AS owner_handle
FROM moderation_items mi
LEFT JOIN moderation_scans ms ON ms.id = mi.scan_id
LEFT JOIN assets a ON mi.target_type = 'asset' AND a.id = mi.target_id
LEFT JOIN accounts acc ON acc.id = mi.account_id
LEFT JOIN users u ON u.id = acc.owner_user_id
WHERE mi.state IN ('pending_review','in_review','escalated');

-- Margin by model — is any provider losing you money?
CREATE VIEW v_model_margin AS
SELECT
  pm.name                                   AS model,
  p.code                                    AS provider,
  f.code                                    AS feature,
  count(*)                                  AS jobs,
  sum(j.micro_credits_charged) / 1e6        AS credits_charged,
  sum(j.provider_cost_usd)                  AS provider_cost_usd,
  avg(extract(epoch FROM (j.completed_at - j.started_at))) AS avg_seconds,
  count(*) FILTER (WHERE j.status = 'failed')::numeric
    / NULLIF(count(*), 0)                   AS failure_rate
FROM jobs j
JOIN provider_models pm ON pm.id = j.provider_model_id
JOIN providers p        ON p.id = pm.provider_id
JOIN features f         ON f.id = j.feature_id
GROUP BY 1, 2, 3;


-- =====================================================================
--  14. LOOKUP SEED — the fixed enumerations named in the comments above.
--  Everything else (providers, models, prices) is admin-panel data.
-- =====================================================================

INSERT INTO roles (code, name, permissions) VALUES
  ('admin',     'Administrator', '["*"]'),
  ('moderator', 'Moderator',     '["moderation.*","posts.review"]'),
  ('support',   'Support',       '["users.read","credits.grant"]'),
  ('user',      'User',          '[]')
ON CONFLICT (code) DO NOTHING;

INSERT INTO features (code, name, modality, sort_order) VALUES
  ('image_generate', 'Generate Image', 'image', 10),
  ('image_edit',     'Edit Image',     'image', 20),
  ('video_generate', 'Generate Video', 'video', 30),
  ('image_to_video', 'Image to Video', 'video', 40),
  ('chat',           'Chat',           'text',  50)
ON CONFLICT (code) DO NOTHING;

COMMIT;
