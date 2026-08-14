-- Smallest thing that fails if the risky logic in schema.sql breaks.
-- Runs entirely inside a transaction and rolls back — leaves no rows behind.
--   docker compose exec -T db psql -U postgres -d deev -v ON_ERROR_STOP=1 < smoke.sql

BEGIN;

DO $$
DECLARE
  u1 uuid; u2 uuid; acct uuid;
  a uuid; b uuid;
  n bigint;
BEGIN
  -- 1. UUIDv7 is time-sortable (the whole reason PKs are safe to paginate on)
  a := uuid_generate_v7();
  PERFORM pg_sleep(0.005);
  b := uuid_generate_v7();
  ASSERT b > a, 'uuid_generate_v7 is not monotonic';

  -- signup dance: user -> account -> back-link (the circular FK)
  INSERT INTO users (email, handle) VALUES ('a@x.io', 'Cinephile') RETURNING id INTO u1;
  INSERT INTO users (email) VALUES ('b@x.io') RETURNING id INTO u2;
  INSERT INTO accounts (owner_user_id) VALUES (u1) RETURNING id INTO acct;
  UPDATE users SET personal_account_id = acct WHERE id = u1;

  -- 2. citext handle is trigram-searchable through the text projection
  SELECT count(*) INTO n FROM users WHERE handle::text ILIKE '%nephi%';
  ASSERT n = 1, 'handle trigram search broken';

  -- 3. follow counters survive a missing user_profiles row
  INSERT INTO follows (follower_user_id, followee_user_id) VALUES (u1, u2);
  SELECT follower_count INTO n FROM user_profiles WHERE user_id = u2;
  ASSERT n = 1, 'follower_count not incremented (missing profile row swallowed it)';
  DELETE FROM follows WHERE follower_user_id = u1;
  SELECT follower_count INTO n FROM user_profiles WHERE user_id = u2;
  ASSERT n = 0, 'follower_count not decremented';

  -- 4. credit_ledger is append-only: UPDATE and DELETE are no-ops, not errors
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (acct, 'grant', 5000000, 5000000);
  UPDATE credit_ledger SET micro_credits = 0 WHERE account_id = acct;
  SELECT micro_credits INTO n FROM credit_ledger WHERE account_id = acct;
  ASSERT n = 5000000, 'ledger UPDATE was not blocked';
  DELETE FROM credit_ledger WHERE account_id = acct;
  SELECT count(*) INTO n FROM credit_ledger WHERE account_id = acct;
  ASSERT n = 1, 'ledger DELETE was not blocked';

  -- 5. one live hold per job — double-submit cannot double-charge
  INSERT INTO credit_holds (account_id, ref_type, ref_id, micro_credits)
    VALUES (acct, 'job', a, 1000000);
  BEGIN
    INSERT INTO credit_holds (account_id, ref_type, ref_id, micro_credits)
      VALUES (acct, 'job', a, 1000000);
    RAISE EXCEPTION 'duplicate live hold was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- but a released hold frees the slot for a retry
  UPDATE credit_holds SET status = 'released', resolved_at = now() WHERE ref_id = a;
  INSERT INTO credit_holds (account_id, ref_type, ref_id, micro_credits)
    VALUES (acct, 'job', a, 1000000);

  -- 6. balance cache cannot go negative
  INSERT INTO account_balances (account_id, micro_credits) VALUES (acct, 100);
  BEGIN
    UPDATE account_balances SET micro_credits = -1 WHERE account_id = acct;
    RAISE EXCEPTION 'negative balance was allowed';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- 7. usage_daily upserts on rows whose feature/model dims are NULL
  INSERT INTO usage_daily (day, account_id, job_count) VALUES (current_date, acct, 1);
  INSERT INTO usage_daily (day, account_id, job_count) VALUES (current_date, acct, 5)
    ON CONFLICT (day, account_id, feature_id, provider_model_id)
    DO UPDATE SET job_count = usage_daily.job_count + EXCLUDED.job_count;
  SELECT job_count INTO n FROM usage_daily WHERE account_id = acct;
  ASSERT n = 6, 'usage_daily rollup did not upsert across NULL dimensions';

  -- 8. a target cannot sit in the moderation queue twice
  INSERT INTO moderation_items (target_type, target_id, account_id) VALUES ('asset', a, acct);
  BEGIN
    INSERT INTO moderation_items (target_type, target_id, account_id) VALUES ('asset', a, acct);
    RAISE EXCEPTION 'duplicate open moderation item was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 9. events land in the right monthly partition automatically
  INSERT INTO events (account_id, name) VALUES (acct, 'job.submitted');
  SELECT count(*) INTO n FROM events WHERE account_id = acct;
  ASSERT n = 1, 'no partition accepted the event';

  RAISE NOTICE 'smoke: core checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 002_commerce.sql: the counters and the entitlement roll-up
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u1 uuid; u2 uuid; acct uuid;
  planA uuid; planB uuid;
  post1 uuid; post2 uuid; cmt uuid; tag1 uuid;
  conv uuid; msg uuid; rate uuid;
  n bigint; e record;
BEGIN
  INSERT INTO users (email) VALUES ('c@x.io') RETURNING id INTO u1;
  INSERT INTO users (email) VALUES ('d@x.io') RETURNING id INTO u2;
  INSERT INTO accounts (owner_user_id) VALUES (u1) RETURNING id INTO acct;

  -- 10. post_count follows the approval transition, not the insert
  INSERT INTO posts (account_id, author_user_id, status) VALUES (acct, u1, 'pending')
    RETURNING id INTO post1;
  n := COALESCE((SELECT post_count FROM user_profiles WHERE user_id = u1), 0);
  ASSERT n = 0, 'pending post counted as public';

  UPDATE posts SET status = 'approved', published_at = now() WHERE id = post1;
  n := COALESCE((SELECT post_count FROM user_profiles WHERE user_id = u1), 0);
  ASSERT n = 1, 'approving a post did not raise post_count';

  UPDATE posts SET deleted_at = now() WHERE id = post1;
  n := COALESCE((SELECT post_count FROM user_profiles WHERE user_id = u1), 0);
  ASSERT n = 0, 'soft-deleting a post did not lower post_count';
  UPDATE posts SET deleted_at = NULL WHERE id = post1;

  -- 11. remix lineage counts on the parent
  INSERT INTO posts (account_id, author_user_id, remixed_from_post_id, status)
    VALUES (acct, u2, post1, 'pending') RETURNING id INTO post2;
  SELECT remix_count INTO n FROM posts WHERE id = post1;
  ASSERT n = 1, 'remix_count not maintained';

  -- 12. comments, and likes on comments
  INSERT INTO post_comments (post_id, user_id, body) VALUES (post1, u2, 'nice')
    RETURNING id INTO cmt;
  SELECT comment_count INTO n FROM posts WHERE id = post1;
  ASSERT n = 1, 'comment_count not maintained';

  INSERT INTO comment_likes (comment_id, user_id) VALUES (cmt, u1);
  SELECT like_count INTO n FROM post_comments WHERE id = cmt;
  ASSERT n = 1, 'comment like_count not maintained';
  DELETE FROM comment_likes WHERE comment_id = cmt;
  SELECT like_count INTO n FROM post_comments WHERE id = cmt;
  ASSERT n = 0, 'comment like_count not decremented';

  -- 13. tag usage
  INSERT INTO tags (slug, name) VALUES ('cinematic', 'Cinematic') RETURNING id INTO tag1;
  INSERT INTO post_tags (post_id, tag_id) VALUES (post1, tag1);
  SELECT post_count INTO n FROM tags WHERE id = tag1;
  ASSERT n = 1, 'tag post_count not maintained';

  -- 14. conversation rollups, including the streaming-then-final update
  INSERT INTO conversations (account_id, user_id) VALUES (acct, u1) RETURNING id INTO conv;
  INSERT INTO messages (conversation_id, role) VALUES (conv, 'user') RETURNING id INTO msg;
  SELECT message_count INTO n FROM conversations WHERE id = conv;
  ASSERT n = 1, 'message_count not maintained';
  ASSERT (SELECT last_message_at IS NOT NULL FROM conversations WHERE id = conv),
    'last_message_at not set';

  INSERT INTO message_usage (message_id, micro_credits_charged) VALUES (msg, 1500);
  SELECT total_micro_credits INTO n FROM conversations WHERE id = conv;
  ASSERT n = 1500, 'conversation spend not accumulated';

  UPDATE message_usage SET micro_credits_charged = 2500 WHERE message_id = msg;
  SELECT total_micro_credits INTO n FROM conversations WHERE id = conv;
  ASSERT n = 2500, 'conversation spend applied the value instead of the delta';

  -- 15. stacked subscriptions: entitlements are the best of everything live
  INSERT INTO plans (code, name, micro_credits_per_term, price_amount, currency,
                     max_concurrent_jobs, max_resolution_px, allow_premium_skills)
    VALUES ('t_basic', 'Basic', 100000000, 500000, 'IRR', 3, 1080, false) RETURNING id INTO planA;
  INSERT INTO plans (code, name, micro_credits_per_term, price_amount, currency,
                     max_concurrent_jobs, max_resolution_px, allow_premium_skills)
    VALUES ('t_pro', 'Pro', 400000000, 1500000, 'IRR', 8, 2160, true) RETURNING id INTO planB;

  SELECT * INTO e FROM v_account_entitlements WHERE account_id = acct;
  ASSERT e.max_concurrent_jobs = 1 AND NOT e.is_subscribed,
    'unsubscribed account did not fall back to free defaults';

  INSERT INTO subscriptions (account_id, plan_id, status, ends_at, micro_credits_granted)
    VALUES (acct, planA, 'active', now() + interval '30 days', 100000000);
  INSERT INTO subscriptions (account_id, plan_id, status, ends_at, micro_credits_granted)
    VALUES (acct, planB, 'active', now() + interval '10 days', 400000000);

  SELECT * INTO e FROM v_account_entitlements WHERE account_id = acct;
  ASSERT e.max_concurrent_jobs = 8, 'stacked terms did not take the higher job limit';
  ASSERT e.max_resolution_px = 2160, 'stacked terms did not take the higher resolution';
  ASSERT e.allow_premium_skills, 'stacked terms did not unlock premium skills';
  ASSERT array_length(e.active_plans, 1) = 2, 'both live terms should be reported';

  -- an admin override may only ever raise the ceiling
  INSERT INTO account_limits (account_id, max_concurrent_jobs) VALUES (acct, 12);
  SELECT * INTO e FROM v_account_entitlements WHERE account_id = acct;
  ASSERT e.max_concurrent_jobs = 12, 'admin override did not raise the limit';

  UPDATE account_limits SET max_concurrent_jobs = 1 WHERE account_id = acct;
  SELECT * INTO e FROM v_account_entitlements WHERE account_id = acct;
  ASSERT e.max_concurrent_jobs = 8, 'admin override lowered a paid entitlement';

  -- an expired term stops granting anything
  UPDATE subscriptions SET status = 'expired' WHERE account_id = acct AND plan_id = planB;
  SELECT * INTO e FROM v_account_entitlements WHERE account_id = acct;
  ASSERT e.max_concurrent_jobs = 3 AND NOT e.allow_premium_skills,
    'expired term still granting entitlements';

  -- 16. an order in Toman carries the dollar rate it was sold at
  INSERT INTO fx_rates (quote_currency, rate, source) VALUES ('IRR', 1150000, 'manual')
    RETURNING id INTO rate;
  INSERT INTO orders (account_id, user_id, plan_id, micro_credits, amount, currency,
                      fx_rate_id, amount_usd)
    VALUES (acct, u1, planA, 100000000, 500000, 'IRR', rate, 0.4348);
  ASSERT (SELECT amount_usd IS NOT NULL FROM orders WHERE account_id = acct),
    'order did not snapshot its USD equivalent';

  RAISE NOTICE 'smoke: commerce checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 003_lifecycle.sql: expiry sweep, translation fallback, one trial per phone
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u uuid; acct uuid; planA uuid; lot_live uuid; lot_dead uuid; sub uuid; skill uuid; feat uuid;
  n bigint; r record;
BEGIN
  INSERT INTO users (email) VALUES ('e@x.io') RETURNING id INTO u;
  INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO acct;
  INSERT INTO account_balances (account_id, micro_credits) VALUES (acct, 9000000);

  -- one term already over, one still running
  INSERT INTO credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
    VALUES (acct, 'purchase', 5000000, 4000000, now() - interval '1 hour') RETURNING id INTO lot_dead;
  INSERT INTO credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
    VALUES (acct, 'purchase', 5000000, 5000000, now() + interval '20 days') RETURNING id INTO lot_live;

  INSERT INTO plans (code, name, micro_credits_per_term, price_amount)
    VALUES ('t_exp', 'Expiring', 5000000, 500000) RETURNING id INTO planA;
  INSERT INTO subscriptions (account_id, plan_id, status, starts_at, ends_at, lot_id)
    VALUES (acct, planA, 'active', now() - interval '31 days', now() - interval '1 hour', lot_dead)
    RETURNING id INTO sub;

  SELECT * INTO r FROM run_term_expiry();
  ASSERT r.subscriptions_expired >= 1, 'expired term not marked expired';
  ASSERT r.lots_expired >= 1, 'lapsed credit lot not swept';

  ASSERT (SELECT status FROM subscriptions WHERE id = sub) = 'expired', 'subscription still active';
  ASSERT (SELECT micro_credits_remaining FROM credit_lots WHERE id = lot_dead) = 0, 'lapsed lot not zeroed';
  ASSERT (SELECT micro_credits_remaining FROM credit_lots WHERE id = lot_live) = 5000000,
    'the sweep burned a lot that had not expired';

  -- the burn is recorded, not silently applied
  SELECT micro_credits INTO n FROM credit_ledger
   WHERE account_id = acct AND entry_type = 'expiry' AND lot_id = lot_dead;
  ASSERT n = -4000000, 'expiry not written to the ledger';

  SELECT micro_credits INTO n FROM account_balances WHERE account_id = acct;
  ASSERT n = 5000000, 'balance cache not reduced by the burn';

  -- running it twice must not double-charge
  SELECT * INTO r FROM run_term_expiry();
  ASSERT r.lots_expired = 0, 'expiry sweep is not idempotent';
  SELECT count(*) INTO n FROM credit_ledger WHERE account_id = acct AND entry_type = 'expiry';
  ASSERT n = 1, 'second sweep wrote a duplicate expiry entry';

  -- 17. translation falls back to the Persian base value
  SELECT id INTO feat FROM features WHERE code = 'image_generate';
  INSERT INTO skills (feature_id, code, name) VALUES (feat, 'cinematic', 'سینمایی')
    RETURNING id INTO skill;
  ASSERT tr('skill', skill, 'en', 'name', 'سینمایی') = 'سینمایی', 'missing translation did not fall back';

  INSERT INTO translations (entity_type, entity_id, locale, field, value)
    VALUES ('skill', skill, 'en', 'name', 'Cinematic');
  ASSERT tr('skill', skill, 'en', 'name', 'سینمایی') = 'Cinematic', 'translation not returned';
  ASSERT tr('skill', skill, 'fa', 'name', 'سینمایی') = 'سینمایی', 'fa should read the base column';

  -- 18. one trial per number, and it outlives the account
  INSERT INTO trial_grants (phone_hash, account_id, micro_credits)
    VALUES ('sha256:abc', acct, 1000000);
  BEGIN
    INSERT INTO trial_grants (phone_hash, account_id, micro_credits)
      VALUES ('sha256:abc', acct, 1000000);
    RAISE EXCEPTION 'a second trial was granted to the same number';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- and it survives the account being erased entirely: the row stays, its
  -- account_id goes null, so re-signing up with the same SIM still gets nothing
  DECLARE throwaway uuid;
  BEGIN
    INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO throwaway;
    INSERT INTO trial_grants (phone_hash, account_id, micro_credits)
      VALUES ('sha256:def', throwaway, 1000000);
    DELETE FROM accounts WHERE id = throwaway;
    ASSERT (SELECT count(*) FROM trial_grants WHERE phone_hash = 'sha256:def') = 1,
      'erasing the account erased the anti-abuse record';
    ASSERT (SELECT account_id IS NULL FROM trial_grants WHERE phone_hash = 'sha256:def'),
      'trial grant kept a dangling account reference';
  END;

  RAISE NOTICE 'smoke: lifecycle checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 004_reconciliation.sql: the cache-vs-ledger watchdog
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u uuid; acct uuid; bad uuid; n bigint; r record;
BEGIN
  INSERT INTO users (email) VALUES ('f@x.io') RETURNING id INTO u;
  INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO acct;

  -- a clean wallet: two ledger entries, cache agrees
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (acct, 'purchase', 10000000, 10000000);
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (acct, 'capture', -2500000, 7500000);
  INSERT INTO account_balances (account_id, micro_credits) VALUES (acct, 7500000);

  ASSERT NOT EXISTS (SELECT 1 FROM v_balance_drift WHERE account_id = acct),
    'a healthy wallet was reported as drifting';
  ASSERT NOT EXISTS (SELECT 1 FROM v_ledger_continuity_breaks WHERE account_id = acct),
    'correct balance_after snapshots flagged as broken';

  -- 19. now corrupt only the cache, exactly how a lost update would
  UPDATE account_balances SET micro_credits = 9999999 WHERE account_id = acct;
  SELECT * INTO r FROM v_balance_drift WHERE account_id = acct;
  ASSERT FOUND, 'drift went undetected';
  ASSERT r.ledger_available = 7500000, 'ledger total computed wrong';
  ASSERT r.available_drift = 2499999, 'drift amount computed wrong';

  -- reporting alone must not change anything
  PERFORM reconcile_account_balances(false);
  SELECT micro_credits INTO n FROM account_balances WHERE account_id = acct;
  ASSERT n = 9999999, 'dry run repaired the cache anyway';

  SELECT * INTO r FROM reconcile_account_balances(true) WHERE account_id = acct;
  ASSERT r.repaired, 'repair did not run';
  SELECT micro_credits INTO n FROM account_balances WHERE account_id = acct;
  ASSERT n = 7500000, 'cache not rebuilt from the ledger';
  ASSERT (SELECT last_reconciled_at IS NOT NULL FROM account_balances WHERE account_id = acct),
    'reconcile did not stamp last_reconciled_at';

  -- the ledger itself must be untouched by any of this
  SELECT count(*) INTO n FROM credit_ledger WHERE account_id = acct;
  ASSERT n = 2, 'reconciliation wrote to the ledger';
  ASSERT NOT EXISTS (SELECT 1 FROM v_balance_drift WHERE account_id = acct),
    'drift persisted after repair';

  -- 20. held credits are reconciled against live holds, not guessed
  INSERT INTO credit_holds (account_id, ref_type, ref_id, micro_credits)
    VALUES (acct, 'job', uuid_generate_v7(), 1200000);
  SELECT * INTO r FROM v_balance_drift WHERE account_id = acct;
  ASSERT FOUND AND r.held_drift = -1200000, 'held drift not detected';
  PERFORM reconcile_account_balances(true);
  SELECT held_micro_credits INTO n FROM account_balances WHERE account_id = acct;
  ASSERT n = 1200000, 'held total not rebuilt from credit_holds';

  -- 21. a negative ledger is an accounting bug, not a stale cache: refuse it
  INSERT INTO users (email) VALUES ('g@x.io') RETURNING id INTO u;
  INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO bad;
  INSERT INTO account_balances (account_id, micro_credits) VALUES (bad, 500);
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (bad, 'capture', -9000, -9000);

  SELECT * INTO r FROM reconcile_account_balances(true) WHERE account_id = bad;
  ASSERT FOUND AND NOT r.repaired, 'a negative ledger was silently clamped';
  ASSERT r.note LIKE '%needs a human%', 'refusal was not explained';
  SELECT micro_credits INTO n FROM account_balances WHERE account_id = bad;
  ASSERT n = 500, 'refused repair still wrote the cache';

  -- 22. an out-of-order write shows up as a broken running balance
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (acct, 'grant', 1000000, 999);   -- snapshot deliberately wrong
  ASSERT EXISTS (SELECT 1 FROM v_ledger_continuity_breaks WHERE account_id = acct),
    'a wrong balance_after snapshot went undetected';

  RAISE NOTICE 'smoke: reconciliation checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 005_security.sql: rate limit policy, auth, MFA, abuse controls
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u uuid; adm uuid; acct uuid; tok uuid; win timestamptz; n bigint; fp text;
BEGIN
  INSERT INTO users (email) VALUES ('h@x.io') RETURNING id INTO u;
  INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO acct;

  -- 23. the plan-less default policy must collide with itself, not duplicate
  BEGIN
    INSERT INTO rate_limit_policies (code, scope, window_seconds, max_requests)
      VALUES ('otp.send', 'phone', 3600, 5);
    RAISE EXCEPTION 'duplicate default rate limit policy was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 24. violations are one row per subject per window, not per request
  win := date_trunc('hour', now());
  INSERT INTO rate_limit_violations (policy_code, scope, subject, user_id, window_start)
    VALUES ('otp.send', 'phone', 'sha256:phone1', u, win);
  INSERT INTO rate_limit_violations (policy_code, scope, subject, user_id, window_start)
    VALUES ('otp.send', 'phone', 'sha256:phone1', u, win)
    ON CONFLICT (policy_code, subject, window_start)
    DO UPDATE SET hits = rate_limit_violations.hits + 1, last_hit_at = now();

  SELECT count(*) INTO n FROM rate_limit_violations WHERE subject = 'sha256:phone1';
  ASSERT n = 1, 'a flood would write one row per request';
  SELECT hits INTO n FROM rate_limit_violations WHERE subject = 'sha256:phone1';
  ASSERT n = 2, 'repeat violations not counted';

  -- 25. lockout is a rolling window, so it heals by itself
  ASSERT recent_login_failures('h@x.io') = 0, 'clean account reported as failing';
  INSERT INTO login_attempts (identifier, user_id, method, succeeded, failure_reason)
    SELECT 'h@x.io', u, 'password', false, 'bad_password' FROM generate_series(1, 3);
  ASSERT recent_login_failures('h@x.io') = 3, 'recent failures not counted';

  -- successes must not clear the count by accident
  INSERT INTO login_attempts (identifier, user_id, method, succeeded)
    VALUES ('h@x.io', u, 'password', true);
  ASSERT recent_login_failures('h@x.io') = 3, 'a success silently reset the failure count';

  -- and the lockout heals on its own once the window passes
  UPDATE login_attempts SET created_at = now() - interval '1 hour'
   WHERE identifier = 'h@x.io' AND NOT succeeded;
  ASSERT recent_login_failures('h@x.io') = 0, 'failures outside the window still counted';

  -- 26. reset tokens are single-use and unguessable by uniqueness
  INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
    VALUES (u, 'password_reset', 'sha256:tok1', now() + interval '30 minutes')
    RETURNING id INTO tok;
  BEGIN
    INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
      VALUES (u, 'password_reset', 'sha256:tok1', now() + interval '30 minutes');
    RAISE EXCEPTION 'a token hash was reused';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 27. an admin with no confirmed MFA is visible; enrolling clears them
  INSERT INTO users (email) VALUES ('admin@x.io') RETURNING id INTO adm;
  INSERT INTO user_roles (user_id, role_code) VALUES (adm, 'admin');
  ASSERT EXISTS (SELECT 1 FROM v_admins_without_mfa WHERE user_id = adm),
    'admin without MFA not surfaced';

  -- an unconfirmed enrolment must not count as protection
  INSERT INTO mfa_credentials (user_id, secret_ref) VALUES (adm, 'vault://mfa/admin');
  ASSERT EXISTS (SELECT 1 FROM v_admins_without_mfa WHERE user_id = adm),
    'half-finished MFA enrolment counted as protected';

  UPDATE mfa_credentials SET confirmed_at = now() WHERE user_id = adm;
  ASSERT NOT EXISTS (SELECT 1 FROM v_admins_without_mfa WHERE user_id = adm),
    'confirmed MFA did not clear the admin';

  -- a plain user without MFA is not an admin gap
  ASSERT NOT EXISTS (SELECT 1 FROM v_admins_without_mfa WHERE user_id = u),
    'ordinary user reported as an unprotected admin';

  -- 28. blocked terms are unique per locale, and shared across locales once
  INSERT INTO blocked_terms (term, locale, severity) VALUES ('badword', 'fa', 'block');
  INSERT INTO blocked_terms (term, locale, severity) VALUES ('badword', 'en', 'block');
  INSERT INTO blocked_terms (term, severity) VALUES ('globalban', 'block');
  BEGIN
    INSERT INTO blocked_terms (term, severity) VALUES ('globalban', 'warn');
    RAISE EXCEPTION 'duplicate all-locale blocked term was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  ASSERT (SELECT severity FROM blocked_terms WHERE term = 'GLOBALBAN') = 'block',
    'blocked terms are not case-insensitive';

  -- 29. trial farming shows up as one device across many accounts
  fp := 'sha256:device1';
  FOR n IN 1..3 LOOP
    INSERT INTO users (email) VALUES ('farm' || n || '@x.io') RETURNING id INTO adm;
    INSERT INTO accounts (owner_user_id) VALUES (adm) RETURNING id INTO acct;
    INSERT INTO device_fingerprints (fingerprint_hash, account_id, user_id, seen_at_signup)
      VALUES (fp, acct, adm, true);
  END LOOP;
  SELECT account_count INTO n FROM v_multi_account_devices WHERE fingerprint_hash = fp;
  ASSERT n = 3, 'multi-account device not detected';

  -- 30. a rejection adds a strike, and only on the transition
  INSERT INTO moderation_items (target_type, target_id, account_id, state)
    VALUES ('asset', uuid_generate_v7(), acct, 'pending_review');
  SELECT COALESCE((SELECT moderation_strikes FROM user_risk WHERE user_id = adm), 0) INTO n;
  ASSERT n = 0, 'a queued item counted as a strike';

  UPDATE moderation_items SET state = 'rejected', resolved_at = now() WHERE account_id = acct;
  SELECT moderation_strikes INTO n FROM user_risk WHERE user_id = adm;
  ASSERT n = 1, 'rejection did not record a strike';

  UPDATE moderation_items SET resolution_note = 'reviewed again' WHERE account_id = acct;
  SELECT moderation_strikes INTO n FROM user_risk WHERE user_id = adm;
  ASSERT n = 1, 'editing a rejected item added a second strike';

  RAISE NOTICE 'smoke: security checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 006_partitioning.sql: monthly partitions and drop-based retention
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u uuid; n bigint; old_month date; part text; this_part text;
BEGIN
  -- 32. both tables really are partitioned now
  ASSERT (SELECT relkind FROM pg_class WHERE relname = 'login_attempts') = 'p',
    'login_attempts is not partitioned';
  ASSERT (SELECT relkind FROM pg_class WHERE relname = 'rate_limit_violations') = 'p',
    'rate_limit_violations is not partitioned';

  -- 33. a row routes into the partition for its own month
  INSERT INTO users (email) VALUES ('i@x.io') RETURNING id INTO u;
  INSERT INTO login_attempts (identifier, user_id, method, succeeded)
    VALUES ('i@x.io', u, 'password', false);

  this_part := 'login_attempts_' || to_char(now(), 'YYYY_MM');
  EXECUTE format('SELECT count(*) FROM %I WHERE identifier = %L', this_part, 'i@x.io') INTO n;
  ASSERT n = 1, 'row did not land in the current month partition';
  ASSERT recent_login_failures('i@x.io') = 1, 'partitioned lookup broke the lockout query';

  -- 34. the upsert key still holds across partitions
  INSERT INTO rate_limit_violations (policy_code, scope, subject, window_start)
    VALUES ('login', 'ip', 'sha256:ip9', date_trunc('hour', now()));
  BEGIN
    INSERT INTO rate_limit_violations (policy_code, scope, subject, window_start)
      VALUES ('login', 'ip', 'sha256:ip9', date_trunc('hour', now()));
    RAISE EXCEPTION 'the violation upsert key stopped being enforced';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 35. retention drops whole months instead of deleting rows
  old_month := (date_trunc('month', now()) - interval '8 months')::date;
  part := 'login_attempts_' || to_char(old_month, 'YYYY_MM');
  EXECUTE format('CREATE TABLE %I PARTITION OF login_attempts FOR VALUES FROM (%L) TO (%L)',
                 part, old_month, old_month + interval '1 month');
  EXECUTE format('INSERT INTO login_attempts (identifier, method, succeeded, created_at)
                  VALUES (%L, %L, false, %L)', 'ancient@x.io', 'password', old_month + 5);

  SELECT detail INTO n FROM purge_security_logs(90) WHERE relation = 'login_attempts';
  ASSERT n >= 1, 'no old partition was dropped';
  ASSERT NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part),
    'the aged partition survived the purge';

  -- and the current month is untouched
  ASSERT EXISTS (SELECT 1 FROM pg_class WHERE relname = this_part),
    'the purge dropped the live partition';
  ASSERT recent_login_failures('i@x.io') = 1, 'the purge took current rows with it';

  -- 36. topping up partitions is idempotent
  PERFORM ensure_all_partitions(3);
  PERFORM ensure_all_partitions(3);
  SELECT count(*) INTO n FROM pg_inherits i
    JOIN pg_class p ON p.oid = i.inhparent WHERE p.relname = 'rate_limit_violations';
  ASSERT n >= 5, 'partition top-up did not create a working window';

  RAISE NOTICE 'smoke: partitioning checks passed';
END $$;

-- ---------------------------------------------------------------------
-- 007/008: collation, least privilege, FK indexes, deletion, scheduling
-- ---------------------------------------------------------------------
DO $$
DECLARE
  u uuid; acct uuid; ord uuid; n bigint; ordered text;
BEGIN
  -- 37. the database sorts Persian the way a Persian speaker expects,
  --     with no explicit COLLATE anywhere in the query
  SELECT string_agg(t, '|' ORDER BY t) INTO ordered
    FROM (VALUES ('کتاب'),('كتاب'),('Zebra'),('آینده')) v(t);
  ASSERT ordered = 'آینده|کتاب|كتاب|Zebra',
    'database default collation is not Persian-tailored, got: ' || ordered;

  -- 38. the app role can work, but cannot rewrite history
  ASSERT     has_table_privilege('deev_app', 'jobs', 'INSERT'),        'app role cannot insert jobs';
  ASSERT     has_table_privilege('deev_app', 'jobs', 'UPDATE'),        'app role cannot update jobs';
  ASSERT     has_table_privilege('deev_app', 'audit_log', 'INSERT'),   'app role cannot write the audit log';
  ASSERT NOT has_table_privilege('deev_app', 'audit_log', 'UPDATE'),   'app role can edit the audit log';
  ASSERT NOT has_table_privilege('deev_app', 'audit_log', 'DELETE'),   'app role can erase the audit log';
  ASSERT NOT has_table_privilege('deev_app', 'credit_ledger', 'UPDATE'),
    'app role can rewrite the ledger';
  ASSERT NOT has_table_privilege('deev_app', 'model_prices', 'DELETE'),
    'app role can delete pricing history';
  ASSERT     has_table_privilege('deev_readonly', 'jobs', 'SELECT'),   'readonly role cannot read';
  ASSERT NOT has_table_privilege('deev_readonly', 'jobs', 'INSERT'),   'readonly role can write';

  -- 39. the foreign keys on real delete paths are indexed
  ASSERT (SELECT count(*) FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname IN ('posts_account_id_idx','collections_user_id_idx',
                               'jobs_parent_job_id_idx','credit_ledger_lot_id_idx')) = 4,
    'expected FK indexes are missing';

  -- 40. Explore content is searchable
  ASSERT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public' AND indexname = 'posts_title_trgm'),
    'no search index on post titles';

  -- 41. anonymize keeps the money and the abuse memory, destroys the person
  INSERT INTO users (email, phone, handle, display_name)
    VALUES ('bye@x.io', '+989120000000', 'goodbye', 'Goodbye') RETURNING id INTO u;
  INSERT INTO accounts (owner_user_id) VALUES (u) RETURNING id INTO acct;
  INSERT INTO orders (account_id, user_id, micro_credits, amount, currency, status)
    VALUES (acct, u, 5000000, 500000, 'IRR', 'paid') RETURNING id INTO ord;
  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after)
    VALUES (acct, 'purchase', 5000000, 5000000);
  INSERT INTO trial_grants (phone_hash, account_id, micro_credits)
    VALUES ('sha256:bye', acct, 1000000);
  INSERT INTO auth_identities (user_id, provider, provider_uid)
    VALUES (u, 'google', 'google-uid-1');
  INSERT INTO sessions (user_id, token_hash, expires_at)
    VALUES (u, 'sha256:sess', now() + interval '1 day');
  INSERT INTO deletion_requests (user_id, status) VALUES (u, 'scheduled');

  PERFORM anonymize_user(u);

  -- identity is gone
  ASSERT (SELECT handle IS NULL AND display_name IS NULL AND phone IS NULL
            AND status = 'deleted' AND deleted_at IS NOT NULL
          FROM users WHERE id = u), 'user was not anonymized';
  ASSERT (SELECT email LIKE 'deleted+%@invalid' FROM users WHERE id = u),
    'email placeholder missing — the email-or-phone CHECK would have failed';
  ASSERT (SELECT count(*) FROM auth_identities WHERE user_id = u) = 0, 'oauth link survived';
  ASSERT (SELECT revoked_at IS NOT NULL FROM sessions WHERE user_id = u), 'session not revoked';

  -- the record that has to survive, survives
  ASSERT (SELECT count(*) FROM orders WHERE id = ord) = 1, 'order was destroyed';
  ASSERT (SELECT count(*) FROM credit_ledger WHERE account_id = acct) = 1, 'ledger was destroyed';
  ASSERT (SELECT count(*) FROM trial_grants WHERE phone_hash = 'sha256:bye') = 1,
    'deleting the account handed back a free trial';
  ASSERT (SELECT status FROM deletion_requests WHERE user_id = u) = 'completed',
    'deletion request not closed out';

  -- 42. one open deletion request per user
  INSERT INTO deletion_requests (user_id, status) VALUES (u, 'pending');
  BEGIN
    INSERT INTO deletion_requests (user_id, status) VALUES (u, 'scheduled');
    RAISE EXCEPTION 'a second open deletion request was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 43. maintenance is scheduled inside the database
  SELECT count(*) INTO n FROM cron.job
   WHERE jobname IN ('term-expiry','balance-reconcile','purge-security-logs',
                     'ensure-partitions','prune-cron-history');
  ASSERT n = 5, 'expected 5 scheduled jobs, found ' || n;

  RAISE NOTICE 'smoke: hardening checks passed';
END $$;


-- =====================================================================
--  CREDIT FUNCTIONS (0010)
--
--  The money path. 0002 shipped the tables and no operations on them; these
--  cover the four that exist now. The last block is the one that matters most:
--  if any of grant / hold / release / capture leaves the balance cache, the
--  ledger's running balance and the lot remainders disagreeing, the
--  reconciliation views from 0004 say so.
-- =====================================================================
DO $$
DECLARE
  a uuid; j uuid := uuid_generate_v7();
  soon uuid; late uuid; h uuid;
  soon_left bigint; late_left bigint; bal bigint; held bigint; spent bigint;
BEGIN
  INSERT INTO accounts (kind) VALUES ('personal') RETURNING id INTO a;

  -- 44. a grant creates a lot, a ledger row and a balance
  soon := grant_credits(a, 'signup_bonus', 12000000, now() + interval '7 days');
  late := grant_credits(a, 'purchase',     50000000, NULL);
  SELECT micro_credits, held_micro_credits INTO bal, held FROM account_balances WHERE account_id = a;
  ASSERT bal = 62000000, 'grant did not reach the balance: ' || bal;
  ASSERT held = 0, 'a grant must not hold anything';

  -- 45. a hold spends the soonest-expiring credit first
  h := hold_credits(a, 20000000, 'job', j);
  SELECT micro_credits_remaining INTO soon_left FROM credit_lots WHERE id = soon;
  SELECT micro_credits_remaining INTO late_left FROM credit_lots WHERE id = late;
  ASSERT soon_left = 0,        'expiring lot should be drained first, has ' || soon_left;
  ASSERT late_left = 42000000, 'undated lot should cover the remainder, has ' || late_left;

  -- 46. held credit leaves the spendable balance without leaving the account
  SELECT micro_credits, held_micro_credits INTO bal, held FROM account_balances WHERE account_id = a;
  ASSERT bal = 42000000,  'hold did not reduce available: ' || bal;
  ASSERT held = 20000000, 'hold did not register as held: ' || held;

  -- 47. one live hold per job, so a resubmit cannot reserve twice
  BEGIN
    PERFORM hold_credits(a, 1000000, 'job', j);
    RAISE EXCEPTION 'a second hold on the same job was allowed';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 48. release returns credit to the lot it came from, expiry intact
  PERFORM release_hold(h);
  SELECT micro_credits_remaining INTO soon_left FROM credit_lots WHERE id = soon;
  ASSERT soon_left = 12000000, 'released credit did not return to its own lot: ' || soon_left;
  SELECT micro_credits, held_micro_credits INTO bal, held FROM account_balances WHERE account_id = a;
  ASSERT bal = 62000000 AND held = 0, 'release did not restore the balance';

  -- 49. capturing less than was held charges only what was used
  h := hold_credits(a, 20000000, 'job', uuid_generate_v7());
  PERFORM capture_hold(h, 15000000);
  SELECT micro_credits, held_micro_credits, lifetime_spent INTO bal, held, spent
    FROM account_balances WHERE account_id = a;
  ASSERT bal = 47000000,   'capture charged the wrong amount, available is ' || bal;
  ASSERT held = 0,         'capture left credit held';
  ASSERT spent = 15000000, 'lifetime_spent should count the capture, not the hold: ' || spent;

  -- 50. a resolved hold cannot be captured again
  BEGIN
    PERFORM capture_hold(h);
    RAISE EXCEPTION 'a captured hold was captured twice';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'smoke: credit function checks passed';
END $$;

DO $$
DECLARE poor uuid; stale uuid; live uuid; refused boolean := false; n int;
BEGIN
  -- 51. an account cannot spend credit it does not have
  INSERT INTO accounts (kind) VALUES ('personal') RETURNING id INTO poor;
  PERFORM grant_credits(poor, 'signup_bonus', 5000000, NULL);
  BEGIN
    PERFORM hold_credits(poor, 9000000, 'job', uuid_generate_v7());
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  ASSERT refused, 'an overspend was allowed';

  -- 52. expired credit is not spendable
  INSERT INTO accounts (kind) VALUES ('personal') RETURNING id INTO stale;
  PERFORM grant_credits(stale, 'signup_bonus', 5000000, now() - interval '1 day');
  refused := false;
  BEGIN
    PERFORM hold_credits(stale, 1000000, 'job', uuid_generate_v7());
  EXCEPTION WHEN check_violation THEN refused := true;
  END;
  ASSERT refused, 'expired credit was spendable';

  -- 53. for every account these functions touched, the cache, the ledger and
  --     the lots still agree.
  --
  --     Scoped to those accounts on purpose. Blocks above this one build their
  --     fixtures by inserting into credit_ledger and credit_lots directly, which
  --     is the right way to test a view in isolation but leaves account_balances
  --     behind by construction — an unscoped count here would report their drift
  --     and say nothing about these functions.
  INSERT INTO accounts (kind) VALUES ('personal') RETURNING id INTO live;
  PERFORM grant_credits(live, 'purchase', 30000000, NULL);
  PERFORM capture_hold(hold_credits(live, 7000000, 'job', uuid_generate_v7()));

  SELECT count(*) INTO n FROM v_balance_drift WHERE account_id IN (poor, stale, live);
  ASSERT n = 0, 'balance cache drifted from the ledger: ' || n || ' rows';
  SELECT count(*) INTO n FROM v_ledger_continuity_breaks WHERE account_id IN (poor, stale, live);
  ASSERT n = 0, 'ledger running balance is broken: ' || n || ' rows';
  SELECT count(*) INTO n FROM v_lot_drift WHERE account_id IN (poor, live);
  ASSERT n = 0, 'lot remainders drifted: ' || n || ' rows';

  -- 54. credit that has expired but not yet been swept is exactly the drift
  --     v_lot_drift is built to surface, and expire_credit_lots() is what
  --     settles it. These functions deliberately do not sweep on the fly: a
  --     read path that mutates balances is a read path that deadlocks.
  SELECT count(*) INTO n FROM v_lot_drift WHERE account_id = stale;
  ASSERT n = 1, 'an expired, unswept lot should show as drift';
  PERFORM expire_credit_lots();
  SELECT count(*) INTO n FROM v_lot_drift WHERE account_id = stale;
  ASSERT n = 0, 'the expiry sweep did not settle the drift';
  SELECT count(*) INTO n FROM v_balance_drift WHERE account_id = stale;
  ASSERT n = 0, 'the expiry sweep left the cache disagreeing with the ledger';

  RAISE NOTICE 'smoke: credit reconciliation checks passed';
END $$;

ROLLBACK;
