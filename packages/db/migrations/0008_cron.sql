-- =====================================================================
--  008 — SCHEDULED MAINTENANCE, INSIDE THE DATABASE
--
--  Requires pg_cron in shared_preload_libraries and cron.database_name
--  pointing at this database. docker-compose.yml sets both; a managed
--  host will have its own switch for it.
--
--  Keeping the schedule here means it moves with the database. An
--  external crontab is the thing everyone forgets when they migrate
--  hosts, and the first sign it was forgotten is credits that never
--  expired and partitions that ran out.
--
--  Times are UTC. 02:00 UTC is 05:30 Tehran — after the overnight lull,
--  before the morning traffic.
-- =====================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- cron.schedule upserts by job name, so re-running this file just
-- rewrites the schedule instead of stacking duplicates.
SELECT cron.schedule(
  'term-expiry',
  '15 2 * * *',
  $$SELECT run_term_expiry()$$);

SELECT cron.schedule(
  'balance-reconcile',
  '30 2 * * *',
  $$SELECT count(*) FROM reconcile_account_balances(true)$$);

SELECT cron.schedule(
  'purge-security-logs',
  '45 2 * * *',
  $$SELECT count(*) FROM purge_security_logs(90)$$);

-- monthly, well ahead of the window running dry
SELECT cron.schedule(
  'ensure-partitions',
  '0 3 1 * *',
  $$SELECT count(*) FROM ensure_all_partitions(3)$$);

-- pg_cron keeps every run in cron.job_run_details forever otherwise
SELECT cron.schedule(
  'prune-cron-history',
  '0 4 * * 0',
  $$DELETE FROM cron.job_run_details WHERE end_time < now() - interval '30 days'$$);

COMMIT;
