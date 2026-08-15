-- =====================================================================
--  005 — RATE LIMIT POLICY, AUTH HARDENING, ADMIN MFA, ABUSE CONTROLS
--
--  Decisions this encodes:
--    * Counters live in Redis. Postgres holds the POLICY (admin-editable)
--      and the VIOLATIONS (investigable). Never the per-request counter —
--      at scale that turns every rejected request into a hot-row write,
--      so an attack would cost you more database than your real traffic.
--    * Login by phone OTP, Google, and email+password.
--    * MFA is required for anyone holding a platform role.
--    * Abuse: blocked prompt terms, signup device fingerprints, per-user
--      risk. No IP/ASN blocking — too many of your users are on VPNs.
--
--  Secrets rule, same as provider_credentials: this file stores hashes and
--  references. Never a live secret, never a raw token, never a phone number
--  where a hash will do.
-- =====================================================================

BEGIN;

-- =====================================================================
--  40. RATE LIMIT POLICY & VIOLATIONS
-- =====================================================================

CREATE TABLE rate_limit_policies (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code           text NOT NULL,          -- 'otp.send','login','job.submit','api.generate'
  description    text,
  scope          text NOT NULL
                   CHECK (scope IN ('ip','user','account','api_key','phone','global')),
  window_seconds integer NOT NULL CHECK (window_seconds > 0),
  max_requests   integer NOT NULL CHECK (max_requests > 0),
  burst          integer,
  plan_id        uuid REFERENCES plans(id),   -- null = applies to everyone
  is_active      boolean NOT NULL DEFAULT true,
  updated_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
-- one policy per (code, scope, plan); NULLS NOT DISTINCT so the plan-less
-- default row collides with itself instead of silently duplicating
CREATE UNIQUE INDEX rate_limit_policies_key
  ON rate_limit_policies (code, scope, plan_id) NULLS NOT DISTINCT;

-- ONE ROW PER SUBJECT PER WINDOW, upserted — not one row per rejected
-- request. Bounded writes even under a flood. Redis decides; this records.
CREATE TABLE rate_limit_violations (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  policy_code  text NOT NULL,
  scope        text NOT NULL,
  subject      text NOT NULL,        -- hashed ip / user id / phone hash
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ip           inet,
  hits         integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL,
  last_hit_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_code, subject, window_start)
);
CREATE INDEX ON rate_limit_violations (window_start DESC);
CREATE INDEX ON rate_limit_violations (user_id, window_start DESC) WHERE user_id IS NOT NULL;

-- Starting points. OTP is first because every send costs you money.
INSERT INTO rate_limit_policies (code, description, scope, window_seconds, max_requests) VALUES
  ('otp.send',     'SMS codes per phone number',      'phone',   3600,  5),
  ('otp.send',     'SMS codes from one address',      'ip',      3600, 15),
  ('otp.verify',   'Code guesses per phone',          'phone',    900, 10),
  ('login',        'Password attempts per account',   'user',     900, 10),
  ('login',        'Password attempts per address',   'ip',       900, 50),
  ('job.submit',   'Generations per account',         'account',   60, 20),
  ('api.generate', 'API generations per key',         'api_key',   60, 60),
  ('post.create',  'Explore submissions per account', 'account',  3600, 30)
ON CONFLICT DO NOTHING;


-- =====================================================================
--  41. AUTH HARDENING
--  Phone OTP already has phone_verifications (003). This adds the
--  password and OAuth halves. auth_identities already covers Google.
-- =====================================================================

-- One table, several purposes. Always a hash, always single-use, always
-- short-lived — a reset link in a mailbox is a password until it expires.
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL
                CHECK (purpose IN ('password_reset','email_verify','magic_link','phone_change')),
  token_hash  text NOT NULL UNIQUE,
  ip          inet,
  user_agent  text,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_tokens (user_id, purpose) WHERE consumed_at IS NULL;
CREATE INDEX ON auth_tokens (expires_at) WHERE consumed_at IS NULL;

-- Lockout is derived from this, not stored: count recent failures in the
-- window. One table instead of two, and no lock state to get stuck.
CREATE TABLE login_attempts (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  identifier     citext NOT NULL,       -- email or phone exactly as typed
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  method         text NOT NULL CHECK (method IN ('password','otp','oauth')),
  succeeded      boolean NOT NULL,
  failure_reason text,                  -- 'bad_password','no_such_user','locked','expired_code'
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON login_attempts (identifier, created_at DESC) WHERE NOT succeeded;
CREATE INDEX ON login_attempts (ip, created_at DESC) WHERE NOT succeeded;
CREATE INDEX ON login_attempts (created_at);

-- Is this identifier currently locked out? Rolling window, no stuck state.
CREATE OR REPLACE FUNCTION recent_login_failures(p_identifier citext,
                                                 p_window interval DEFAULT interval '15 minutes')
RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM login_attempts
   WHERE identifier = p_identifier
     AND NOT succeeded
     AND created_at > now() - p_window;
$$;


-- =====================================================================
--  42. MFA — required for anyone holding a platform role
-- =====================================================================

CREATE TABLE mfa_credentials (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind         text NOT NULL DEFAULT 'totp' CHECK (kind IN ('totp','webauthn')),
  secret_ref   text NOT NULL,        -- pointer into your secret store, not the seed
  label        text NOT NULL DEFAULT 'default',
  confirmed_at timestamptz,          -- unconfirmed = enrolment started, not finished
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, label)
);
CREATE INDEX ON mfa_credentials (user_id) WHERE confirmed_at IS NOT NULL;

CREATE TABLE mfa_recovery_codes (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL UNIQUE,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON mfa_recovery_codes (user_id) WHERE used_at IS NULL;

-- The enforcement is in your login code; this is how you find the gaps.
-- Should always be empty. Put it on the admin dashboard.
CREATE VIEW v_admins_without_mfa AS
SELECT
  u.id                          AS user_id,
  u.email,
  u.handle,
  array_agg(ur.role_code ORDER BY ur.role_code) AS roles,
  u.last_seen_at
FROM users u
JOIN user_roles ur ON ur.user_id = u.id AND ur.role_code <> 'user'
WHERE u.status = 'active' AND u.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM mfa_credentials m
     WHERE m.user_id = u.id AND m.confirmed_at IS NOT NULL)
GROUP BY u.id, u.email, u.handle, u.last_seen_at;


-- =====================================================================
--  43. ABUSE CONTROLS
-- =====================================================================

-- Checked before submit, so you never pay a provider to generate something
-- that gets your provider account banned. Persian and English lists differ.
CREATE TABLE blocked_terms (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  term       citext NOT NULL,
  match_type text NOT NULL DEFAULT 'substring'
               CHECK (match_type IN ('exact','substring','regex')),
  locale     text,                     -- null = every locale
  severity   text NOT NULL DEFAULT 'block'
               CHECK (severity IN ('warn','flag','block')),
  category   text,                     -- 'csam','violence','public_figure','trademark'
  is_active  boolean NOT NULL DEFAULT true,
  notes      text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX blocked_terms_key ON blocked_terms (term, locale) NULLS NOT DISTINCT;
CREATE INDEX ON blocked_terms (severity) WHERE is_active;

-- One person, many phone numbers, many free trials. The hash is the link.
CREATE TABLE device_fingerprints (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  fingerprint_hash text NOT NULL,
  account_id       uuid REFERENCES accounts(id) ON DELETE SET NULL,
  user_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  seen_at_signup   boolean NOT NULL DEFAULT false,
  ip               inet,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fingerprint_hash, account_id)
);
CREATE INDEX ON device_fingerprints (fingerprint_hash);
CREATE INDEX ON device_fingerprints (account_id);

-- One device, several accounts. Not proof of abuse — shared computers and
-- families exist — but it is where you look first for trial farming.
CREATE VIEW v_multi_account_devices AS
SELECT
  fingerprint_hash,
  count(DISTINCT account_id)              AS account_count,
  count(*) FILTER (WHERE seen_at_signup)  AS signups,
  min(first_seen_at)                      AS first_seen_at,
  max(last_seen_at)                       AS last_seen_at
FROM device_fingerprints
WHERE account_id IS NOT NULL
GROUP BY fingerprint_hash
HAVING count(DISTINCT account_id) > 2;

CREATE TABLE user_risk (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  score              integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  level              text NOT NULL DEFAULT 'normal'
                       CHECK (level IN ('trusted','normal','watch','restricted')),
  moderation_strikes integer NOT NULL DEFAULT 0,
  chargeback_count   integer NOT NULL DEFAULT 0,
  signals            jsonb NOT NULL DEFAULT '{}'::jsonb,  -- spend velocity, reject rate …
  note               text,
  computed_at        timestamptz,
  updated_by         uuid REFERENCES users(id),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON user_risk (level) WHERE level IN ('watch','restricted');

-- Strikes accrue automatically. level stays manual / nightly-computed on
-- purpose: an automatic restriction on a false positive is a support ticket
-- and a lost customer, so a threshold belongs in reviewable code, not here.
CREATE OR REPLACE FUNCTION bump_moderation_strikes()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  owner_id uuid;
BEGIN
  IF NEW.state = 'rejected'
     AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM 'rejected')
     AND NEW.account_id IS NOT NULL THEN
    SELECT owner_user_id INTO owner_id FROM accounts WHERE id = NEW.account_id;
    IF owner_id IS NOT NULL THEN
      INSERT INTO user_risk (user_id, moderation_strikes) VALUES (owner_id, 1)
        ON CONFLICT (user_id) DO UPDATE
          SET moderation_strikes = user_risk.moderation_strikes + 1,
              updated_at = now();
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER moderation_items_strikes
  AFTER INSERT OR UPDATE OF state ON moderation_items
  FOR EACH ROW EXECUTE FUNCTION bump_moderation_strikes();


-- =====================================================================
--  44. RETENTION
--  Security logs grow fastest and age worst. Nothing here is needed after
--  a quarter, and keeping personal data longer than it is useful is a
--  liability, not an asset.
--
--  Cron, nightly:  SELECT * FROM purge_security_logs(90);
-- =====================================================================

CREATE OR REPLACE FUNCTION purge_security_logs(p_days integer DEFAULT 90)
RETURNS TABLE (relation text, rows_deleted bigint) LANGUAGE plpgsql AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(days => p_days);
  n bigint;
BEGIN
  DELETE FROM login_attempts WHERE created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; relation := 'login_attempts'; rows_deleted := n; RETURN NEXT;

  DELETE FROM phone_verifications WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; relation := 'phone_verifications'; rows_deleted := n; RETURN NEXT;

  DELETE FROM auth_tokens
   WHERE created_at < cutoff AND (consumed_at IS NOT NULL OR expires_at < now());
  GET DIAGNOSTICS n = ROW_COUNT; relation := 'auth_tokens'; rows_deleted := n; RETURN NEXT;

  DELETE FROM rate_limit_violations WHERE window_start < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; relation := 'rate_limit_violations'; rows_deleted := n; RETURN NEXT;

  DELETE FROM sessions
   WHERE (revoked_at IS NOT NULL OR expires_at < now()) AND created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT; relation := 'sessions'; rows_deleted := n; RETURN NEXT;
END $$;


DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['rate_limit_policies','blocked_terms','user_risk'] LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END $$;

COMMIT;
