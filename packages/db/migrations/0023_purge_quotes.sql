-- 0023 — expired quotes are rubbish, and nothing was throwing them out.
--
-- A quote is a price we committed to for a few minutes. Once it expires
-- unspent it can never become a job, and nothing in the product reads it again:
-- the gallery, the ledger and the analytics all key off `jobs`. It is pure
-- residue, and there was no job on the schedule that removed any of it.
--
-- That mattered more than it sounds, because until the rate limiter landed
-- alongside this migration, `POST /generation/quotes` had no ceiling. A load
-- test wrote 8,933 of these rows in twenty minutes from one session without
-- being refused once. The limiter is the tap; this is the drain. Either alone
-- leaves the table growing without bound — slower, in the case of the limiter.
--
-- A quote that produced a job is kept forever and is not touched here. It is
-- the evidence of what a customer was charged and why, `jobs.quote_id`
-- references it, and the FK would refuse the delete anyway.

BEGIN;

CREATE OR REPLACE FUNCTION purge_expired_quotes(p_grace interval DEFAULT interval '7 days')
RETURNS bigint AS $$
DECLARE
  v_deleted bigint;
BEGIN
  -- The grace period is not caution about the expiry check, which is exact.
  -- It is so that a support question asked the same week — "why was I quoted
  -- that?" — can still be answered from the row rather than from a guess.
  WITH gone AS (
    DELETE FROM quotes
    WHERE expires_at < now() - p_grace
      AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.quote_id = quotes.id)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM gone;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION purge_expired_quotes(interval) IS
  'Deletes unspent quotes older than the grace period. Quotes that became jobs are kept forever.';

-- Daily, in the same quiet window as the other housekeeping, and after them:
-- nothing here competes with the ledger work, but a long delete is easier to
-- attribute when it is not running beside one.
SELECT cron.schedule(
  'purge-expired-quotes',
  '0 4 * * *',
  $$SELECT purge_expired_quotes()$$);

-- The purge scans by expiry; the submission path looks a quote up by id, so
-- nothing had a reason to index this column until now. Not partial: an index
-- predicate cannot contain the "did this become a job" subquery, and the
-- anti-join is cheap once the expiry scan has narrowed the set.
CREATE INDEX IF NOT EXISTS quotes_expires_at_idx ON quotes (expires_at);

COMMIT;
