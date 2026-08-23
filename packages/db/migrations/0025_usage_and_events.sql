-- =====================================================================
--  0025 — the two analytics tables nothing was writing to
--
--  `events` and `usage_daily` have existed since 0001. `events` has a
--  monthly partition scheme, an index on (name, occurred_at) and a cron
--  job in 0008 keeping its window topped up. `usage_daily` has a unique
--  key over (day, account, feature, model) and twelve counter columns.
--
--  Both have been empty this whole time. Nothing inserted a row into
--  either, so the partition maintenance was maintaining nothing and the
--  0002 comment telling you to "take those two from usage_daily" was
--  pointing at an empty table.
--
--  This file fills them, and the two halves are deliberately different
--  mechanisms because they answer different questions.
--
--    * `events` is what happened, as it happens. It is written by a
--      trigger, so no application path can forget it — not the API, not
--      the worker, not whatever writes jobs next.
--
--    * `usage_daily` is what it added up to. It is recomputed on a
--      schedule from `jobs`, which is the source of truth, so a wrong
--      number is always one re-run away from being right.
--
--  On triggers: 0002 says posts.view_count and skills.usage_count are
--  deliberately NOT triggers, because both would UPDATE one hot row on
--  every view and turn a popular preset into a serialization point.
--  Appending to a partitioned log is the opposite shape — no shared row,
--  no contention, and the write is proportional to the thing that caused
--  it rather than to how popular that thing is.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
--  A default partition, so analytics can never refuse a customer's job.
--
--  The trigger below writes an event inside the same transaction as the
--  job. Without a default partition, an INSERT whose occurred_at falls
--  outside every existing partition fails — and that failure would not
--  land on a dashboard, it would land on the submission. The window is
--  kept three months ahead by cron and would have to lapse badly for
--  this to catch anything, which is exactly why it should exist: the
--  failure mode is rare, remote, and catastrophically disproportionate.
--
--  Rows here are not lost, only misfiled, and `ensure_monthly_partitions`
--  will refuse to create an overlapping partition while any sit in it —
--  which is the loud, early signal that the window lapsed.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events_unpartitioned PARTITION OF events DEFAULT;

COMMENT ON TABLE events_unpartitioned IS
  'Catch-all so an analytics insert can never fail a transaction. Anything in here means the monthly partition window lapsed.';

-- ---------------------------------------------------------------------
--  What happened: the job lifecycle, written where it cannot be missed.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION record_job_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A draft is not a submission. It is a row somebody may never send.
    IF NEW.status = 'draft' THEN RETURN NULL; END IF;
    v_name := 'job.submitted';
  ELSE
    -- `UPDATE OF status` fires on any write that names the column, including
    -- one that sets it to what it already was. Only a real transition is an
    -- event; the rest would be duplicates nobody could tell apart afterwards.
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NULL; END IF;
    v_name := CASE
      WHEN NEW.status = 'succeeded' THEN 'job.succeeded'
      WHEN NEW.status = 'failed' THEN 'job.failed'
      WHEN NEW.status = 'cancelled' THEN 'job.cancelled'
      WHEN NEW.status = 'expired' THEN 'job.expired'
      -- A draft being sent is a submission, and it is the one submission that
      -- does not arrive as an INSERT.
      WHEN NEW.status = 'queued' AND OLD.status = 'draft' THEN 'job.submitted'
      ELSE NULL
    END;
    -- 'running' is not an event. It is the provider picking the work up, which
    -- is the worker's business and answers no question anyone asks of this
    -- table.
    IF v_name IS NULL THEN RETURN NULL; END IF;
  END IF;

  INSERT INTO events (occurred_at, account_id, user_id, name, properties)
  VALUES (
    -- clock_timestamp() and not the column's default of now(). `now()` is the
    -- transaction's start time, so a job submitted and settled in one
    -- transaction would stamp both events identically and the stream would
    -- lose the order they happened in — which is the one thing an event stream
    -- is for. It also reports a long transaction's events as all happening at
    -- the moment it opened.
    clock_timestamp(),
    NEW.account_id,
    NEW.created_by,
    v_name,
    -- Ours, and no upstream identifier among them: `provider_model_id` is the
    -- catalogue row, not the supplier's name for it. This table is read by
    -- staff, but it is also the thing most likely to be exported to somewhere
    -- with looser access than the database has.
    jsonb_build_object(
      'jobId', NEW.id,
      'featureId', NEW.feature_id,
      'providerModelId', NEW.provider_model_id,
      'origin', NEW.origin,
      'microCredits', NEW.micro_credits_charged,
      'outputs', NEW.output_count,
      'errorCode', NEW.error_code
    )
  );
  RETURN NULL;
END $$;

COMMENT ON FUNCTION record_job_event() IS
  'Writes job.submitted / succeeded / failed / cancelled / expired into events. Status transitions only.';

DROP TRIGGER IF EXISTS jobs_events ON jobs;
CREATE TRIGGER jobs_events
  AFTER INSERT OR UPDATE OF status ON jobs
  FOR EACH ROW EXECUTE FUNCTION record_job_event();

-- ---------------------------------------------------------------------
--  What it added up to: the daily rollup.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION roll_up_usage_daily(p_days_back integer DEFAULT 3)
RETURNS bigint AS $$
DECLARE
  v_from date := (now() AT TIME ZONE 'UTC')::date - p_days_back;
  v_rows bigint;
BEGIN
  -- Recomputed, not accumulated. A job created near midnight finishes on the
  -- next day and changes yesterday's charged total after yesterday's rollup
  -- already ran; an incremental counter would carry that error forever, and a
  -- recompute is one re-run away from correct. Three days back by default
  -- because nothing here runs longer than that, and the cost is a scan of a
  -- few thousand rows.
  DELETE FROM usage_daily WHERE day >= v_from;

  WITH written AS (
    INSERT INTO usage_daily (
      day, account_id, feature_id, provider_model_id,
      job_count, success_count, failure_count,
      micro_credits_charged, provider_cost_usd, output_assets
    )
    SELECT
      -- The day it was asked for, not the day it finished. A generation belongs
      -- to one day whatever it does afterwards, which is how a person reads
      -- "usage on the 5th" — and it keeps a slow job from moving between rows.
      (job.created_at AT TIME ZONE 'UTC')::date AS day,
      job.account_id,
      job.feature_id,
      job.provider_model_id,
      count(*),
      count(*) FILTER (WHERE job.status = 'succeeded'),
      -- Cancelled and expired are not failures. Nobody was charged and nothing
      -- went wrong; counting them here would make the failure rate a measure of
      -- how often people change their minds.
      count(*) FILTER (WHERE job.status = 'failed'),
      coalesce(sum(job.micro_credits_charged), 0),
      coalesce(sum(job.provider_cost_usd), 0),
      coalesce(sum(job.output_count), 0)
    FROM jobs job
    WHERE job.created_at >= v_from
      -- A draft was never submitted. It is not usage.
      AND job.status <> 'draft'
    GROUP BY 1, 2, 3, 4
    RETURNING 1
  )
  SELECT count(*) INTO v_rows FROM written;

  RETURN v_rows;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION roll_up_usage_daily(integer) IS
  'Recomputes the last N days of usage_daily from jobs. Idempotent: it deletes the window before writing it.';

-- `input_tokens` and `output_tokens` stay zero, and that is honest rather than
-- unfinished: `jobs` has no token columns, because a generation is priced per
-- output and not per token. They belong to the chat tables, which have no
-- rollup yet either.

-- 05:00 UTC, after the balance reconcile at 02:30 and the security-log purge
-- at 02:45. Later than both on purpose: this reads `jobs` while they write
-- other tables, and a long scan is easier to attribute when it is alone.
SELECT cron.schedule(
  'roll-up-usage',
  '0 5 * * *',
  $$SELECT roll_up_usage_daily()$$);

COMMIT;
