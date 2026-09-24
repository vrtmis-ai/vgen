-- =====================================================================
--  78. EVERY USER HAS A USERNAME
--
--  `users.handle` has been `citext UNIQUE` since migration 0001, with a trigram
--  index built for searching it, and the community feed has always read
--  `coalesce(author.handle, author.display_name)`. Nothing has ever written to
--  it. In production that meant the ten seeded demo authors had handles and
--  every real customer had none, so the public feed credited people by whatever
--  display name their signup happened to leave behind.
--
--  Two things happen here, and the order matters: fill the column, then require
--  it. Every insert path mints one from the same commit, so NOT NULL becomes a
--  promise the database keeps rather than a convention each new route has to
--  remember.
--
--  Latin only -- see packages/core/src/handles.ts for why: Arabic and Persian
--  forms of the same letter render alike, and a handle set that admits both is
--  an impersonation surface.
-- =====================================================================

-- Row by row rather than one UPDATE, because the suffix has to avoid handles
-- that already exist as well as the ones being minted beside it. A set-based
-- version can only see its own batch, and a real customer whose email happens
-- to match a seeded author's handle would abort the migration -- and with it
-- the deploy. This runs once, over a table with fourteen rows in it today.
DO $$
DECLARE
  person      record;
  base        text;
  candidate   text;
  attempt     int;
  -- Same list as RESERVED in packages/core/src/handles.ts. Duplicated on
  -- purpose: a migration that imports application code is a migration whose
  -- meaning changes after it has run.
  reserved    text[] := ARRAY[
    'about','academy','admin','administrator','api','coins','community','contact','cookies','deev','deevapp',
    'effects','explore','gallery','help','login','me','mod','moderator','null','official','owner','plans',
    'privacy','profile','root','settings','signup','staff','studio','support','system','team','terms',
    'undefined','vgen','www'
  ];
BEGIN
  FOR person IN
    SELECT id, coalesce(split_part(email::text, '@', 1), phone, '') AS seed
    FROM users WHERE handle IS NULL ORDER BY created_at, id
  LOOP
    -- The same transformation as mintHandle: lowercase, drop anything outside
    -- [a-z0-9._], and no leading or trailing separator.
    base := regexp_replace(
      regexp_replace(lower(person.seed), '[^a-z0-9._]', '', 'g'),
      '^[._]+|[._]+$', '', 'g'
    );
    IF length(base) < 3 OR base = ANY(reserved) THEN
      base := 'user' || base;
    END IF;
    base := rtrim(left(base, 24), '._');
    -- Nothing usable in the address at all. The id always yields 24 characters.
    IF length(base) < 3 THEN
      base := left('user' || replace(person.id::text, '-', ''), 24);
    END IF;

    candidate := base;
    attempt := 1;
    -- The oldest account keeps the plain name; later ones are numbered.
    WHILE EXISTS (SELECT 1 FROM users WHERE handle = candidate::citext) LOOP
      attempt := attempt + 1;
      candidate := rtrim(left(base, 24 - length(attempt::text)), '._') || attempt::text;
    END LOOP;

    UPDATE users SET handle = candidate WHERE id = person.id;
  END LOOP;
END $$;

ALTER TABLE users ALTER COLUMN handle SET NOT NULL;

-- ---------------------------------------------------------------------
--  anonymize_user() nulled the handle, which the line above now forbids.
--
--  Migration 0007 erases everything that identifies a deleted person and set
--  `handle = NULL` among them. With the column required that call would fail,
--  and account deletion is not a thing that may start failing. The email
--  beside it already shows the shape of the answer -- an unroutable
--  placeholder, unique per user -- so the handle gets the same treatment
--  rather than the column getting an exception.
--
--  Unique by construction: the id is, and nothing else may start with
--  `deleted` followed by 17 hex characters, since a real handle has to be at
--  most 24 and is minted from an address.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION anonymize_user(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE users SET
    email             = 'deleted+' || p_user_id::text || '@invalid',
    phone             = NULL,
    email_verified_at = NULL,
    phone_verified_at = NULL,
    password_hash     = NULL,
    handle            = 'deleted' || left(replace(p_user_id::text, '-', ''), 17),
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

  DELETE FROM auth_identities          WHERE user_id = p_user_id;
  DELETE FROM mfa_credentials          WHERE user_id = p_user_id;
  DELETE FROM mfa_recovery_codes       WHERE user_id = p_user_id;
  DELETE FROM auth_tokens              WHERE user_id = p_user_id;
  DELETE FROM notification_preferences WHERE user_id = p_user_id;
  DELETE FROM notifications            WHERE user_id = p_user_id;

  UPDATE device_fingerprints SET user_id = NULL WHERE user_id = p_user_id;

  UPDATE deletion_requests SET status = 'completed', completed_at = now()
   WHERE user_id = p_user_id AND status IN ('pending','scheduled');
END;
$$;
