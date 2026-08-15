-- =====================================================================
--  006 — PARTITION THE TWO FASTEST-GROWING TABLES
--
--  login_attempts and rate_limit_violations grow with attack traffic, not
--  with real usage, and every row ages into worthlessness within a quarter.
--  DELETE on tables like that leaves dead tuples behind, and autovacuum
--  ends up fighting the write path exactly when you are under load.
--
--  Monthly range partitions instead, same as events: retention becomes
--  DROP TABLE — instant, no dead rows, space returned to the filesystem.
--
--  TRADE-OFF, on purpose: dropping partitions is coarser than deleting
--  rows. purge_security_logs(90) now removes whole months once the entire
--  month is past the cutoff, so data lives a little longer than the exact
--  day count. That is the correct trade for a log; use DELETE only if a
--  regulator ever asks for to-the-day deletion of these specific tables.
--
--  Cron:  monthly  SELECT ensure_all_partitions(3);
--         nightly  SELECT * FROM purge_security_logs(90);
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Generic partition maintenance. schema.sql shipped an events-only
-- version; this replaces it with one that works for any monthly table.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ensure_monthly_partitions(p_table text,
                                                     p_months_ahead integer DEFAULT 3)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  m     date;
  pname text;
  made  integer := 0;
BEGIN
  FOR m IN
    SELECT generate_series(date_trunc('month', now() - interval '1 month'),
                           date_trunc('month', now()) + make_interval(months => p_months_ahead),
                           interval '1 month')::date
  LOOP
    pname := p_table || '_' || to_char(m, 'YYYY_MM');
    -- checked rather than IF NOT EXISTS, so the count means "created" and a
    -- monthly cron run stays silent instead of logging a notice per partition
    IF to_regclass('public.' || quote_ident(pname)) IS NULL THEN
      EXECUTE format('CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                     pname, p_table, m, m + interval '1 month');
      made := made + 1;
    END IF;
  END LOOP;
  RETURN made;
END $$;

-- Partition names carry their month, so retention needs no bound parsing.
CREATE OR REPLACE FUNCTION drop_old_partitions(p_table text, p_keep_months integer)
RETURNS TABLE (dropped text) LANGUAGE plpgsql AS $$
DECLARE
  r      record;
  cutoff date := (date_trunc('month', now()) - make_interval(months => p_keep_months))::date;
BEGIN
  FOR r IN
    SELECT c.relname AS name
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      JOIN pg_namespace n ON n.oid = p.relnamespace AND n.nspname = 'public'
     WHERE p.relname = p_table
       AND c.relname ~ '_\d{4}_\d{2}$'
  LOOP
    IF to_date(right(r.name, 7), 'YYYY_MM') < cutoff THEN
      EXECUTE format('DROP TABLE %I', r.name);
      dropped := r.name;
      RETURN NEXT;
    END IF;
  END LOOP;
END $$;

-- kept so the older cron line and README still work
CREATE OR REPLACE FUNCTION ensure_event_partitions(months_ahead integer DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM ensure_monthly_partitions('events', months_ahead);
END $$;

CREATE OR REPLACE FUNCTION ensure_all_partitions(p_months_ahead integer DEFAULT 3)
RETURNS TABLE (relation text, partitions_ensured integer) LANGUAGE plpgsql AS $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events', 'login_attempts', 'rate_limit_violations'] LOOP
    relation := t;
    partitions_ensured := ensure_monthly_partitions(t, p_months_ahead);
    RETURN NEXT;
  END LOOP;
END $$;


-- ---------------------------------------------------------------------
-- login_attempts -> partitioned by created_at
--
-- The partition key has to be in the primary key, so id alone becomes
-- (id, created_at) — the same shape events already uses. The copy below
-- fails loudly rather than silently dropping anything that falls outside
-- the created partitions; that is the failure mode you want.
-- ---------------------------------------------------------------------

ALTER TABLE login_attempts RENAME TO login_attempts_old;

CREATE TABLE login_attempts (
  id             uuid NOT NULL DEFAULT uuid_generate_v7(),
  identifier     citext NOT NULL,
  user_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  method         text NOT NULL CHECK (method IN ('password','otp','oauth')),
  succeeded      boolean NOT NULL,
  failure_reason text,
  ip             inet,
  user_agent     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX ON login_attempts (identifier, created_at DESC) WHERE NOT succeeded;
CREATE INDEX ON login_attempts (ip, created_at DESC) WHERE NOT succeeded;
CREATE INDEX ON login_attempts (created_at);

SELECT ensure_monthly_partitions('login_attempts', 12);

INSERT INTO login_attempts
  (id, identifier, user_id, method, succeeded, failure_reason, ip, user_agent, created_at)
SELECT id, identifier, user_id, method, succeeded, failure_reason, ip, user_agent, created_at
  FROM login_attempts_old;

DROP TABLE login_attempts_old;


-- ---------------------------------------------------------------------
-- rate_limit_violations -> partitioned by window_start
--
-- The upsert key already leads with the partition column, so
-- UNIQUE (policy_code, subject, window_start) stays enforceable globally.
-- ---------------------------------------------------------------------

ALTER TABLE rate_limit_violations RENAME TO rate_limit_violations_old;

CREATE TABLE rate_limit_violations (
  id           uuid NOT NULL DEFAULT uuid_generate_v7(),
  policy_code  text NOT NULL,
  scope        text NOT NULL,
  subject      text NOT NULL,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  ip           inet,
  hits         integer NOT NULL DEFAULT 1,
  window_start timestamptz NOT NULL,
  last_hit_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, window_start),
  UNIQUE (policy_code, subject, window_start)
) PARTITION BY RANGE (window_start);

CREATE INDEX ON rate_limit_violations (window_start DESC);
CREATE INDEX ON rate_limit_violations (user_id, window_start DESC) WHERE user_id IS NOT NULL;

SELECT ensure_monthly_partitions('rate_limit_violations', 12);

INSERT INTO rate_limit_violations
  (id, policy_code, scope, subject, user_id, account_id, ip, hits, window_start, last_hit_at)
SELECT id, policy_code, scope, subject, user_id, account_id, ip, hits, window_start, last_hit_at
  FROM rate_limit_violations_old;

DROP TABLE rate_limit_violations_old;


-- ---------------------------------------------------------------------
-- Retention: drop months for the partitioned tables, delete rows for the
-- rest. One nightly call either way.
-- ---------------------------------------------------------------------

-- The swap left the new indexes with "1" suffixes, because the renamed old
-- table still held the base names when they were created. Deterministic, but
-- login_attempts_pkey1 reads like a mistake. Take the names back.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS name, left(c.relname, length(c.relname) - 1) AS wanted
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
     WHERE c.relkind IN ('i','I')
       AND c.relname ~ '^(login_attempts|rate_limit_violations)_.*1$'
  LOOP
    IF to_regclass('public.' || quote_ident(r.wanted)) IS NULL THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.name, r.wanted);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS purge_security_logs(integer);

CREATE FUNCTION purge_security_logs(p_days integer DEFAULT 90)
RETURNS TABLE (relation text, method text, detail bigint) LANGUAGE plpgsql AS $$
DECLARE
  cutoff timestamptz := now() - make_interval(days => p_days);
  months integer     := GREATEST(p_days / 30, 1);
  n      bigint;
BEGIN
  -- whole months, dropped: instant, and the space comes back
  SELECT count(*) INTO n FROM drop_old_partitions('login_attempts', months);
  relation := 'login_attempts'; method := 'dropped_partitions'; detail := n; RETURN NEXT;

  SELECT count(*) INTO n FROM drop_old_partitions('rate_limit_violations', months);
  relation := 'rate_limit_violations'; method := 'dropped_partitions'; detail := n; RETURN NEXT;

  -- small tables, still row-at-a-time
  DELETE FROM phone_verifications WHERE sent_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  relation := 'phone_verifications'; method := 'deleted_rows'; detail := n; RETURN NEXT;

  DELETE FROM auth_tokens
   WHERE created_at < cutoff AND (consumed_at IS NOT NULL OR expires_at < now());
  GET DIAGNOSTICS n = ROW_COUNT;
  relation := 'auth_tokens'; method := 'deleted_rows'; detail := n; RETURN NEXT;

  DELETE FROM sessions
   WHERE (revoked_at IS NOT NULL OR expires_at < now()) AND created_at < cutoff;
  GET DIAGNOSTICS n = ROW_COUNT;
  relation := 'sessions'; method := 'deleted_rows'; detail := n; RETURN NEXT;
END $$;

COMMIT;
