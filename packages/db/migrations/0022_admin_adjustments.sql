-- =====================================================================
--  0022 — ADJUSTING A BALANCE BY HAND
--
--  Support needs to be able to put coins back after something went wrong,
--  and to take them away when something was given by mistake. There was no
--  way to do either: `grant_credits` refuses a non-positive amount, and
--  every other movement in the system is tied to a hold and a job.
--
--  Doing it from application code was the alternative and it is the wrong
--  one. A correct removal has to consume lots FIFO honouring expiry, write
--  an append-only ledger row whose `balance_after` actually matches, and
--  move the balance cache — three writes that are only correct together.
--  `capture_hold` already does exactly that dance, so this follows it
--  rather than inventing a second version of it a few lines away in
--  TypeScript.
--
--  Two rules this function holds:
--
--    * **It never drives a balance negative.** Asking to remove more than
--      is spendable is refused outright rather than clamped. Clamping would
--      make "take back the 500 coins we gave them" silently take back however
--      many were left, and the person doing it would have no idea.
--
--    * **It cannot touch held coins.** `account_balances.micro_credits` is
--      already net of holds — `hold_credits` moves them into
--      `held_micro_credits` — so a generation in flight cannot have its
--      money pulled out from under it by an adjustment made at the same
--      moment.
--
--  The ledger is append-only at the database (rules block UPDATE and
--  DELETE on `credit_ledger`), so the record of who adjusted what cannot
--  be tidied away afterwards by whoever did it. `created_by` is required
--  for that reason and the admin route always passes the staff user.
-- =====================================================================

CREATE OR REPLACE FUNCTION adjust_credits(
  p_account_id    uuid,
  p_micro_credits bigint,          -- signed: + gives, - takes away
  p_note          text,
  p_created_by    uuid
) RETURNS uuid AS $$
DECLARE
  v_balance   bigint;
  v_remaining bigint;
  v_take      bigint;
  v_lot       record;
  v_entry     uuid;
BEGIN
  IF p_micro_credits = 0 THEN
    RAISE EXCEPTION 'adjust_credits: nothing to adjust' USING errcode = '22023';
  END IF;

  -- Giving is already a solved problem, and routing it through
  -- grant_credits means an adjustment creates a real lot that expires and
  -- reconciles like every other. A second way of adding credits would be a
  -- second thing for `reconcile_account_balances` to disagree with.
  IF p_micro_credits > 0 THEN
    PERFORM grant_credits(p_account_id, 'admin_grant', p_micro_credits, NULL, p_note, p_created_by);
    RETURN NULL;
  END IF;

  SELECT micro_credits INTO v_balance FROM account_balances
    WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'adjust_credits: no such account %', p_account_id USING errcode = '23503';
  END IF;

  v_remaining := -p_micro_credits;
  IF v_remaining > v_balance THEN
    -- Refused, not clamped. See the header.
    RAISE EXCEPTION 'adjust_credits: cannot remove % from a spendable balance of %', v_remaining, v_balance
      USING errcode = '23514';
  END IF;

  -- FIFO, expiring lots first, exactly as capture_hold spends. Taking from
  -- the newest lot instead would leave a soon-to-expire lot full and quietly
  -- destroy coins the customer still had.
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
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- The balance cache said there was enough and the lots did not have it.
  -- That is drift, and `v_balance_drift` exists to find it; failing loudly
  -- here is better than writing a ledger row that makes it permanent.
  IF v_remaining <> 0 THEN
    RAISE EXCEPTION 'adjust_credits: lots were short by % — balance cache and lots disagree', v_remaining
      USING errcode = '23514';
  END IF;

  INSERT INTO credit_ledger (account_id, entry_type, micro_credits, balance_after, note, created_by)
  VALUES (p_account_id, 'adjustment', p_micro_credits, v_balance + p_micro_credits, p_note, p_created_by)
  RETURNING id INTO v_entry;

  UPDATE account_balances
  SET micro_credits = micro_credits + p_micro_credits,
      updated_at = now()
  WHERE account_id = p_account_id;

  RETURN v_entry;
END
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION adjust_credits IS
  'Hand adjustment of a balance by staff. Positive delegates to grant_credits; negative consumes lots FIFO and refuses to overdraw.';
