-- Close the TRUNCATE hole in the append-only tables.
--
-- 0001 and 0003 protect credit_ledger, job_events, config_history,
-- admin_audit_log and frontend_error_reports with two things: a revoke of
-- update/delete from app_user, and a BEFORE UPDATE OR DELETE ... FOR EACH ROW
-- trigger. Neither covers TRUNCATE.
--
-- TRUNCATE is its own privilege in Postgres — revoking delete does not revoke
-- it — and row-level triggers do not fire for it at all, because it never
-- touches a row. So `truncate credit_ledger` would empty the money ledger and
-- both guards would stay silent. The append-only claim held only as long as
-- nobody typed that word.
--
-- Statement-level triggers do fire on truncate, and they reuse the same
-- forbid_mutation() function 0001 already defines.

create trigger credit_ledger_no_truncate
  before truncate on credit_ledger
  for each statement execute function forbid_mutation();

create trigger job_events_no_truncate
  before truncate on job_events
  for each statement execute function forbid_mutation();

create trigger config_history_no_truncate
  before truncate on config_history
  for each statement execute function forbid_mutation();

create trigger admin_audit_log_no_truncate
  before truncate on admin_audit_log
  for each statement execute function forbid_mutation();

create trigger frontend_error_reports_no_truncate
  before truncate on frontend_error_reports
  for each statement execute function forbid_mutation();

-- Belt and braces, matching how 0001 pairs a revoke with each trigger. The
-- trigger is the real guarantee — it also binds the table owner, who cannot be
-- stopped by a revoke — but taking the grant away means the ordinary app role
-- fails at permission-check time rather than inside a trigger.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'revoke truncate on credit_ledger, job_events, config_history, admin_audit_log, frontend_error_reports from app_user';
  end if;
end
$$;
