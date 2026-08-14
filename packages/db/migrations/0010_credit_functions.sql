-- =====================================================================
--  58. THE CREDIT FUNCTIONS
--
--  0002 built the two-phase money model — credit_lots, credit_ledger,
--  credit_holds, account_balances — and left the operations on it unwritten.
--  These are them. Everything that moves credit goes through this file, because
--  each movement has to keep four things in step at once:
--
--    credit_lots        FIFO buckets, the source of what is actually spendable
--    credit_ledger      append-only truth, carrying a running balance_after
--    credit_holds       the reserved-but-not-yet-charged middle state
--    account_balances   a cache, reconcilable against the ledger
--
--  Doing that in application code means every caller has to get all four right,
--  and the reconciliation views in 0004 exist precisely because one of them
--  eventually will not. In here it is one implementation, inside one
--  transaction, holding the right row locks.
--
--  Sign convention is 0004's: grant / purchase / refund / release positive,
--  hold / capture / expiry negative.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Which lots a hold took from.
--
--  Needed for release. Without it, returning credit means picking lots by some
--  rule, and every rule is wrong: return to the newest lot and a customer can
--  extend the life of expiring credit indefinitely by starting and cancelling
--  jobs; return FIFO and the credit lands in a bucket that expires sooner than
--  the one it came from. Credit goes back exactly where it came from.
-- ---------------------------------------------------------------------
CREATE TABLE credit_hold_lots (
  hold_id       uuid NOT NULL REFERENCES credit_holds(id) ON DELETE CASCADE,
  lot_id        uuid NOT NULL REFERENCES credit_lots(id),
  micro_credits bigint NOT NULL CHECK (micro_credits > 0),
  PRIMARY KEY (hold_id, lot_id)
);
CREATE INDEX credit_hold_lots_lot_idx ON credit_hold_lots (lot_id);


-- ---------------------------------------------------------------------
--  grant_credits — money in.
--
--  Creates a lot, writes the ledger entry, moves the cache. Used by purchases,
--  the signup bonus, promo redemptions, invite rewards and admin adjustments;
--  `p_source` is what tells them apart, and it is the same CHECK list
--  credit_lots already enforces.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION grant_credits(
  p_account_id    uuid,
  p_source        text,
  p_micro_credits bigint,
  p_expires_at    timestamptz DEFAULT NULL,
  p_note          text        DEFAULT NULL,
  p_created_by    uuid        DEFAULT NULL,
  p_ref_type      text        DEFAULT NULL,
  p_ref_id        uuid        DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_lot_id  uuid;
  v_balance bigint;
BEGIN
  IF p_micro_credits <= 0 THEN
    RAISE EXCEPTION 'grant_credits requires a positive amount, got %', p_micro_credits
      USING errcode = '22023';
  END IF;

  -- Lock the balance row first and take the same lock in the same order
  -- everywhere in this file, so a grant racing a hold cannot deadlock.
  INSERT INTO account_balances (account_id) VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;
  SELECT micro_credits INTO v_balance FROM account_balances
    WHERE account_id = p_account_id FOR UPDATE;

  INSERT INTO credit_lots (account_id, source, micro_credits_total, micro_credits_remaining, expires_at)
  VALUES (p_account_id, p_source, p_micro_credits, p_micro_credits, p_expires_at)
  RETURNING id INTO v_lot_id;

  INSERT INTO credit_ledger (account_id, lot_id, entry_type, micro_credits, balance_after, ref_type, ref_id, note, created_by)
  VALUES (p_account_id, v_lot_id, 'grant', p_micro_credits, v_balance + p_micro_credits, p_ref_type, p_ref_id, p_note, p_created_by);

  UPDATE account_balances
  SET micro_credits = micro_credits + p_micro_credits,
      lifetime_purchased = lifetime_purchased + CASE WHEN p_source = 'purchase' THEN p_micro_credits ELSE 0 END,
      updated_at = now()
  WHERE account_id = p_account_id;

  RETURN v_lot_id;
END
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
--  hold_credits — money reserved.
--
--  Takes FIFO across lots by soonest expiry, so the credit closest to being
--  lost is spent first. Returns the hold id; raises 'insufficient_credits'
--  (SQLSTATE 23514) when the account cannot cover it, which callers should
--  translate into a 402 rather than a 500.
--
--  The unique index on (ref_type, ref_id) WHERE status = 'held' is what makes
--  this idempotent per job: a retry of the same submission collides rather than
--  reserving twice.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hold_credits(
  p_account_id    uuid,
  p_micro_credits bigint,
  p_ref_type      text,
  p_ref_id        uuid,
  p_expires_at    timestamptz DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_hold_id   uuid;
  v_balance   bigint;
  v_available bigint;
  v_remaining bigint := p_micro_credits;
  v_take      bigint;
  v_lot       record;
BEGIN
  IF p_micro_credits <= 0 THEN
    RAISE EXCEPTION 'hold_credits requires a positive amount, got %', p_micro_credits
      USING errcode = '22023';
  END IF;

  INSERT INTO account_balances (account_id) VALUES (p_account_id)
    ON CONFLICT (account_id) DO NOTHING;
  SELECT micro_credits INTO v_balance FROM account_balances
    WHERE account_id = p_account_id FOR UPDATE;

  -- Checked against the lots rather than the cache: the lots are the truth, and
  -- a stale cache must never be the reason a customer is allowed to overspend.
  -- FOR UPDATE here also serialises two concurrent holds on the same account.
  SELECT coalesce(sum(micro_credits_remaining), 0) INTO v_available
  FROM credit_lots
  WHERE account_id = p_account_id
    AND micro_credits_remaining > 0
    AND (expires_at IS NULL OR expires_at > now());

  IF v_available < p_micro_credits THEN
    RAISE EXCEPTION 'insufficient_credits: have %, need %', v_available, p_micro_credits
      USING errcode = '23514';
  END IF;

  INSERT INTO credit_holds (account_id, ref_type, ref_id, micro_credits, expires_at)
  VALUES (p_account_id, p_ref_type, p_ref_id, p_micro_credits, coalesce(p_expires_at, now() + interval '1 hour'))
  RETURNING id INTO v_hold_id;

  FOR v_lot IN
    SELECT id, micro_credits_remaining
    FROM credit_lots
    WHERE account_id = p_account_id
      AND micro_credits_remaining > 0
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining = 0;
    v_take := least(v_lot.micro_credits_remaining, v_remaining);

    UPDATE credit_lots SET micro_credits_remaining = micro_credits_remaining - v_take WHERE id = v_lot.id;
    INSERT INTO credit_hold_lots (hold_id, lot_id, micro_credits) VALUES (v_hold_id, v_lot.id, v_take);

    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining <> 0 THEN
    -- Unreachable given the check above, and worth failing loudly if the lot
    -- rows and their sum ever disagree rather than reserving less than asked.
    RAISE EXCEPTION 'hold_credits could not allocate % of %', v_remaining, p_micro_credits
      USING errcode = '23514';
  END IF;

  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after, ref_type, ref_id)
  VALUES (p_account_id, 'hold', -p_micro_credits, v_balance - p_micro_credits, p_ref_type, p_ref_id);

  UPDATE account_balances
  SET micro_credits = micro_credits - p_micro_credits,
      held_micro_credits = held_micro_credits + p_micro_credits,
      updated_at = now()
  WHERE account_id = p_account_id;

  RETURN v_hold_id;
END
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
--  release_hold — the reservation is abandoned, money goes back.
--
--  Each lot gets back exactly what it gave, which is what credit_hold_lots is
--  for. Expiry dates are therefore untouched: a released credit expires on the
--  same day it would have if it had never been reserved.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION release_hold(p_hold_id uuid) RETURNS void AS $$
DECLARE
  v_hold    record;
  v_balance bigint;
BEGIN
  SELECT * INTO v_hold FROM credit_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'release_hold: no such hold %', p_hold_id USING errcode = '23503';
  END IF;
  -- Not an error: a release racing an expiry sweep is normal, and the second
  -- one has nothing left to do.
  IF v_hold.status <> 'held' THEN RETURN; END IF;

  SELECT micro_credits INTO v_balance FROM account_balances
    WHERE account_id = v_hold.account_id FOR UPDATE;

  UPDATE credit_lots l
  SET micro_credits_remaining = l.micro_credits_remaining + hl.micro_credits
  FROM credit_hold_lots hl
  WHERE hl.hold_id = p_hold_id AND l.id = hl.lot_id;

  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after, ref_type, ref_id)
  VALUES (v_hold.account_id, 'release', v_hold.micro_credits, v_balance + v_hold.micro_credits, v_hold.ref_type, v_hold.ref_id);

  UPDATE account_balances
  SET micro_credits = micro_credits + v_hold.micro_credits,
      held_micro_credits = held_micro_credits - v_hold.micro_credits,
      updated_at = now()
  WHERE account_id = v_hold.account_id;

  UPDATE credit_holds SET status = 'released', resolved_at = now() WHERE id = p_hold_id;
END
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------
--  capture_hold — the work happened, charge for it.
--
--  Written as a release of the whole reservation followed by a charge for what
--  was actually used, which is two ledger rows rather than one. That is
--  deliberate: it keeps every row's sign matching 0004's convention, it makes an
--  under-capture self-evident in the ledger rather than implied by a difference
--  between two columns, and any unused remainder returns to the exact lots it
--  was taken from instead of to whichever lot happens to be next.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION capture_hold(p_hold_id uuid, p_micro_credits bigint DEFAULT NULL) RETURNS void AS $$
DECLARE
  v_hold      record;
  v_captured  bigint;
  v_balance   bigint;
  v_remaining bigint;
  v_take      bigint;
  v_lot       record;
BEGIN
  SELECT * INTO v_hold FROM credit_holds WHERE id = p_hold_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'capture_hold: no such hold %', p_hold_id USING errcode = '23503';
  END IF;
  IF v_hold.status <> 'held' THEN
    RAISE EXCEPTION 'capture_hold: hold % is already %', p_hold_id, v_hold.status USING errcode = '23514';
  END IF;

  v_captured := coalesce(p_micro_credits, v_hold.micro_credits);
  IF v_captured < 0 OR v_captured > v_hold.micro_credits THEN
    RAISE EXCEPTION 'capture_hold: cannot capture % of a % hold', v_captured, v_hold.micro_credits
      USING errcode = '22023';
  END IF;

  SELECT micro_credits INTO v_balance FROM account_balances
    WHERE account_id = v_hold.account_id FOR UPDATE;

  -- Give it all back first, to the lots it came from.
  UPDATE credit_lots l
  SET micro_credits_remaining = l.micro_credits_remaining + hl.micro_credits
  FROM credit_hold_lots hl
  WHERE hl.hold_id = p_hold_id AND l.id = hl.lot_id;

  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after, ref_type, ref_id)
  VALUES (v_hold.account_id, 'release', v_hold.micro_credits, v_balance + v_hold.micro_credits, v_hold.ref_type, v_hold.ref_id);

  UPDATE account_balances
  SET micro_credits = micro_credits + v_hold.micro_credits,
      held_micro_credits = held_micro_credits - v_hold.micro_credits,
      updated_at = now()
  WHERE account_id = v_hold.account_id;

  v_balance := v_balance + v_hold.micro_credits;

  -- Then take what was actually used, FIFO again. An expiry that fell due while
  -- the job ran is honoured here rather than silently spent.
  IF v_captured > 0 THEN
    v_remaining := v_captured;
    FOR v_lot IN
      SELECT id, micro_credits_remaining
      FROM credit_lots
      WHERE account_id = v_hold.account_id
        AND micro_credits_remaining > 0
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY expires_at ASC NULLS LAST, created_at ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining = 0;
      v_take := least(v_lot.micro_credits_remaining, v_remaining);
      UPDATE credit_lots SET micro_credits_remaining = micro_credits_remaining - v_take WHERE id = v_lot.id;
      v_remaining := v_remaining - v_take;
    END LOOP;

    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'capture_hold could not charge % of %', v_remaining, v_captured USING errcode = '23514';
    END IF;

    INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after, ref_type, ref_id)
    VALUES (v_hold.account_id, 'capture', -v_captured, v_balance - v_captured, v_hold.ref_type, v_hold.ref_id);

    UPDATE account_balances
    SET micro_credits = micro_credits - v_captured,
        lifetime_spent = lifetime_spent + v_captured,
        updated_at = now()
    WHERE account_id = v_hold.account_id;
  END IF;

  UPDATE credit_holds
  SET status = 'captured', captured_micro_credits = v_captured, resolved_at = now()
  WHERE id = p_hold_id;
END
$$ LANGUAGE plpgsql;
