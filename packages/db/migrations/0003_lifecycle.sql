-- =====================================================================
--  003 — TERM EXPIRY, BILINGUAL CONTENT, TRIAL ABUSE CONTROL
--
--  Decisions this encodes:
--    * Unspent credits burn when the term ends. Each term's lot carries
--      expires_at, and a nightly sweep writes the ledger entry — the
--      ledger stays the truth, the sweep never just zeroes a number.
--    * Persian is the primary language and lives in the base columns.
--      English lives in translations. Adding a third locale is rows.
--    * One trial per verified phone, and the record survives account
--      deletion — otherwise "delete account, sign up again" is free credits.
--    * Explore auto-approves clean posts: no schema change needed, the
--      moderation tables already model exactly that. See the note below.
-- =====================================================================

BEGIN;

-- =====================================================================
--  30. TERM EXPIRY
--  Run both from cron, nightly:  SELECT * FROM run_term_expiry();
-- =====================================================================

-- Credits burn per lot, so the FIFO index on credit_lots already spends
-- the soonest-dying credits first when terms are stacked.
CREATE OR REPLACE FUNCTION expire_credit_lots()
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  r   record;
  bal bigint;
  cnt integer := 0;
BEGIN
  FOR r IN
    SELECT l.id, l.account_id, l.micro_credits_remaining
      FROM credit_lots l
     WHERE l.expires_at IS NOT NULL
       AND l.expires_at <= now()
       AND l.micro_credits_remaining > 0
     ORDER BY l.account_id, l.expires_at
     FOR UPDATE OF l
  LOOP
    UPDATE account_balances
       SET micro_credits = GREATEST(micro_credits - r.micro_credits_remaining, 0),
           updated_at    = now()
     WHERE account_id = r.account_id
    RETURNING micro_credits INTO bal;

    -- the ledger is the truth; the balance cache is only a cache
    INSERT INTO credit_ledger (account_id, lot_id, entry_type, micro_credits,
                               balance_after, ref_type, ref_id, note)
    VALUES (r.account_id, r.id, 'expiry', -r.micro_credits_remaining,
            COALESCE(bal, 0), 'credit_lot', r.id, 'term ended');

    UPDATE credit_lots SET micro_credits_remaining = 0 WHERE id = r.id;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END $$;

CREATE OR REPLACE FUNCTION run_term_expiry(
  OUT subscriptions_expired integer,
  OUT lots_expired integer
) RETURNS record LANGUAGE plpgsql AS $$
BEGIN
  UPDATE subscriptions
     SET status = 'expired', updated_at = now()
   WHERE status = 'active' AND ends_at <= now();
  GET DIAGNOSTICS subscriptions_expired = ROW_COUNT;

  lots_expired := expire_credit_lots();
END $$;

-- Warn before it happens: the sweep is not the first the user hears of it.
CREATE VIEW v_terms_ending_soon AS
SELECT
  s.account_id,
  acc.owner_user_id                       AS user_id,
  p.code                                  AS plan,
  s.ends_at,
  sum(l.micro_credits_remaining) / 1e6    AS credits_at_risk
FROM subscriptions s
JOIN plans p     ON p.id = s.plan_id
JOIN accounts acc ON acc.id = s.account_id
LEFT JOIN credit_lots l ON l.id = s.lot_id AND l.micro_credits_remaining > 0
WHERE s.status = 'active'
  AND s.ends_at BETWEEN now() AND now() + interval '3 days'
GROUP BY 1, 2, 3, 4;


-- =====================================================================
--  31. BILINGUAL CONTENT
--  Base columns hold Persian. translations holds every other locale.
--  Polymorphic on purpose — it matches how moderation_items already
--  points at four different target types, and it means adding a preset
--  never needs a migration.
-- =====================================================================

CREATE TABLE translations (
  entity_type text NOT NULL
                CHECK (entity_type IN ('skill','skill_collection','feature',
                                       'plan','tag','notification_template')),
  entity_id   uuid NOT NULL,
  locale      text NOT NULL,          -- 'en', 'ar', …  ('fa' lives in the base row)
  field       text NOT NULL,          -- 'name','description','caption'
  value       text NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_type, entity_id, locale, field)
);
CREATE INDEX ON translations (entity_type, entity_id);

-- Read a field in the caller's locale, falling back to the Persian base value.
CREATE OR REPLACE FUNCTION tr(p_type text, p_id uuid, p_locale text,
                              p_field text, p_fallback text)
RETURNS text LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(
    (SELECT t.value FROM translations t
      WHERE t.entity_type = p_type AND t.entity_id = p_id
        AND t.locale = p_locale AND t.field = p_field),
    p_fallback);
$$;

-- Notification copy is per-locale template, not a per-row string, so the
-- same event reads correctly for a Persian and an English user.
CREATE TABLE notification_templates (
  type       text NOT NULL,           -- 'job_ready','post_approved', …
  locale     text NOT NULL,
  channel    text NOT NULL DEFAULT 'in_app'
               CHECK (channel IN ('in_app','email','push','sms')),
  title      text NOT NULL,
  body       text,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, locale, channel)
);

INSERT INTO app_settings (key, value) VALUES
  ('default_locale',    '"fa"'::jsonb),
  ('supported_locales', '["fa","en"]'::jsonb)
ON CONFLICT (key) DO NOTHING;


-- =====================================================================
--  32. PHONE VERIFICATION & ONE TRIAL PER NUMBER
-- =====================================================================

CREATE TABLE phone_verifications (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone        text NOT NULL,              -- E.164
  code_hash    text NOT NULL,              -- never the code itself
  attempts     integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  ip           inet,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '5 minutes',
  consumed_at  timestamptz
);
-- supports both "is this code still valid" and "how many did we send them"
CREATE INDEX ON phone_verifications (phone, sent_at DESC);
CREATE INDEX ON phone_verifications (ip, sent_at DESC) WHERE ip IS NOT NULL;

-- The anti-abuse record. Keyed by a HASH of the number and deliberately not
-- cascaded from users: deleting an account must remove the person's phone
-- number from your database without handing them a second free trial.
CREATE TABLE trial_grants (
  phone_hash    text PRIMARY KEY,
  account_id    uuid REFERENCES accounts(id) ON DELETE SET NULL,
  micro_credits bigint NOT NULL,
  lot_id        uuid REFERENCES credit_lots(id) ON DELETE SET NULL,
  granted_at    timestamptz NOT NULL DEFAULT now()
);


-- =====================================================================
--  33. EXPLORE AUTO-APPROVAL — no new tables, on purpose
--
--  The flow you picked is already expressible:
--    scan passes  -> posts.status = 'approved', published_at = now(),
--                    moderation_scans row with verdict 'pass', no queue item
--    scan flags   -> posts.status stays 'pending',
--                    moderation_items(trigger='auto_scan', state='pending_review')
--                    which v_moderation_queue already surfaces
--
--  Only the thresholds are missing, and those are configuration, not schema.
-- =====================================================================

INSERT INTO app_settings (key, value) VALUES
  ('moderation.auto_approve_below', '{"nsfw":0.35,"violence":0.35,"minors":0.05}'::jsonb),
  ('moderation.hard_block_above',   '{"nsfw":0.90,"violence":0.90,"minors":0.20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
