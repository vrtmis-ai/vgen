-- =====================================================================
--  63. THE AUDIT TRAIL IS ACTUALLY IMMUTABLE
--
--  0007 protects `audit_log` with `REVOKE UPDATE, DELETE ... FROM deev_app`.
--  A grant does not bind the table owner, and it does not bind a superuser, so
--  the append-only claim held only for the application role — while the trail
--  exists precisely to survive whoever made the change being audited.
--
--  Row-level triggers bind everyone. `credit_ledger` uses rules that silently
--  do nothing, which is right for a ledger a batch job might blindly UPDATE;
--  here it should be loud, because there is no legitimate reason to edit an
--  audit row and a silent no-op would hide the attempt.
--
--  0009 already added the TRUNCATE guard, which rules never cover.
-- =====================================================================

CREATE TRIGGER audit_log_no_mutate
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
