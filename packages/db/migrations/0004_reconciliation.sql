-- =====================================================================
--  004 — BALANCE RECONCILIATION
--
--  account_balances is a cache. credit_ledger is the truth. Nothing in
--  the schema forces them to agree, so this file is the watchdog that
--  tells you they stopped — before a customer does.
--
--  The repair path only ever rewrites the CACHE. The ledger is
--  append-only by rule and stays that way: if the ledger is wrong, that
--  is a bug to fix with a compensating 'adjustment' entry, by a human.
--
--  Ledger sign convention this assumes:
--    purchase / grant / refund / release  -> positive
--    hold / capture / expiry              -> negative
--    adjustment                           -> either
--  so available balance == SUM(micro_credits), open holds included as
--  negatives, and held_micro_credits mirrors credit_holds.status='held'.
--
--  Cron, nightly:  SELECT * FROM reconcile_account_balances(true);
-- =====================================================================

BEGIN;

DROP VIEW IF EXISTS v_balance_drift;
DROP VIEW IF EXISTS v_ledger_continuity_breaks;
DROP VIEW IF EXISTS v_lot_drift;

-- ---------------------------------------------------------------------
-- The ledger needs a total order, and it did not have one.
--
-- created_at defaults to now(), which is the TRANSACTION timestamp: every
-- entry written in one transaction shares it. The tiebreak was id, but two
-- UUIDv7s minted in the same millisecond differ only in their random tail,
-- so they sort arbitrarily. Two entries written together therefore had no
-- defined order — which makes every running-balance check meaningless.
--
-- seq fixes it independently of any clock. created_at moves to
-- clock_timestamp() so the timestamps within a transaction differ too.
-- ---------------------------------------------------------------------
ALTER TABLE credit_ledger ADD COLUMN IF NOT EXISTS seq bigserial;
ALTER TABLE credit_ledger ALTER COLUMN created_at SET DEFAULT clock_timestamp();
CREATE INDEX IF NOT EXISTS credit_ledger_account_seq_idx ON credit_ledger (account_id, seq);

-- Every account whose cache disagrees with its ledger, and by how much.
-- Empty view = healthy. Alert on any row.
CREATE VIEW v_balance_drift AS
SELECT
  b.account_id,
  b.micro_credits                                   AS cached_available,
  COALESCE(l.ledger_sum, 0)                         AS ledger_available,
  b.micro_credits - COALESCE(l.ledger_sum, 0)       AS available_drift,
  b.held_micro_credits                              AS cached_held,
  COALESCE(h.held_sum, 0)                           AS actual_held,
  b.held_micro_credits - COALESCE(h.held_sum, 0)    AS held_drift,
  b.last_reconciled_at
FROM account_balances b
LEFT JOIN LATERAL (
  SELECT sum(micro_credits) AS ledger_sum
    FROM credit_ledger WHERE account_id = b.account_id
) l ON true
LEFT JOIN LATERAL (
  SELECT sum(micro_credits) AS held_sum
    FROM credit_holds WHERE account_id = b.account_id AND status = 'held'
) h ON true
WHERE b.micro_credits      IS DISTINCT FROM COALESCE(l.ledger_sum, 0)
   OR b.held_micro_credits IS DISTINCT FROM COALESCE(h.held_sum, 0);

-- Each ledger row carries a running-balance snapshot. If a write landed
-- out of order or a concurrent writer read a stale balance, the snapshot
-- stops matching the running sum — and that is the earliest signal you get
-- that two requests raced on the same wallet.
CREATE VIEW v_ledger_continuity_breaks AS
SELECT id, seq, account_id, created_at, entry_type, micro_credits,
       balance_after, expected_balance,
       balance_after - expected_balance AS snapshot_drift
FROM (
  SELECT id, seq, account_id, created_at, entry_type, micro_credits, balance_after,
         sum(micro_credits) OVER (PARTITION BY account_id ORDER BY seq)::bigint AS expected_balance
    FROM credit_ledger
) s
WHERE balance_after IS DISTINCT FROM expected_balance;

-- Lots are the other half of the story: what is left in unexpired lots
-- should equal what the account can still spend.
CREATE VIEW v_lot_drift AS
SELECT
  b.account_id,
  b.micro_credits                     AS available,
  COALESCE(lots.remaining, 0)         AS lots_remaining,
  b.micro_credits - COALESCE(lots.remaining, 0) AS drift
FROM account_balances b
LEFT JOIN LATERAL (
  SELECT sum(micro_credits_remaining) AS remaining
    FROM credit_lots
   WHERE account_id = b.account_id
     AND (expires_at IS NULL OR expires_at > now())
) lots ON true
WHERE b.micro_credits IS DISTINCT FROM COALESCE(lots.remaining, 0);

-- Report drift, and optionally repair the cache from the ledger.
--
-- Repair is refused when the ledger itself sums negative: that is not a
-- stale cache, it is a real accounting bug, and silently clamping it to
-- zero would erase the evidence. Those rows come back repaired = false.
CREATE OR REPLACE FUNCTION reconcile_account_balances(p_repair boolean DEFAULT false)
RETURNS TABLE (
  account_id        uuid,
  cached_available  bigint,
  ledger_available  bigint,
  available_drift   bigint,
  held_drift        bigint,
  repaired          boolean,
  note              text
) LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM v_balance_drift LOOP
    account_id       := r.account_id;
    cached_available := r.cached_available;
    ledger_available := r.ledger_available;
    available_drift  := r.available_drift;
    held_drift       := r.held_drift;
    repaired         := false;
    note             := NULL;

    IF r.ledger_available < 0 THEN
      note := 'ledger sums negative — accounting bug, not a stale cache; needs a human';
    ELSIF p_repair THEN
      UPDATE account_balances
         SET micro_credits      = r.ledger_available,
             held_micro_credits = r.actual_held,
             last_reconciled_at = now(),
             updated_at         = now()
       WHERE account_balances.account_id = r.account_id;
      repaired := true;
      note     := 'cache rewritten from ledger';
    ELSE
      note := 'drift detected, repair not requested';
    END IF;

    RETURN NEXT;
  END LOOP;

  -- Stamp the healthy accounts too, otherwise last_reconciled_at only ever
  -- moves on the broken ones and you cannot tell "clean" from "never checked".
  -- One sequential UPDATE per night; revisit if this table gets very large.
  IF p_repair THEN
    -- table-qualified: the OUT parameter above is also called account_id
    UPDATE account_balances b SET last_reconciled_at = now()
     WHERE NOT EXISTS (SELECT 1 FROM v_balance_drift v WHERE v.account_id = b.account_id);
  END IF;
END $$;

COMMIT;
