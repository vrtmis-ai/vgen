-- ---------------------------------------------------------------------
--  An invite code says when it stops working
--
--  invite_codes has had expires_at and max_redemptions since 0011, and
--  redeem_invite() has honoured both, but the view the admin console reads
--  never selected expires_at, so nobody could see when a code would stop
--  working, and the console could not edit either limit.
--
--  Appended at the end rather than beside the other limits: CREATE OR
--  REPLACE VIEW may add columns only after the existing ones.
--
--  is_usable also learns starts_at. redeem_invite() refuses a code that has
--  not started, and the column that tells an operator a code works should
--  not disagree with the function that decides it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_invite_performance AS
SELECT
  ic.id,
  ic.code,
  ic.label,
  ic.kind,
  ic.is_active AND ic.revoked_at IS NULL
    AND ic.starts_at <= now()
    AND (ic.expires_at IS NULL OR ic.expires_at > now())
    AND (ic.max_redemptions IS NULL OR ic.redemption_count < ic.max_redemptions) AS is_usable,
  ic.revoked_at,
  ic.max_redemptions,
  ic.redemption_count,
  ic.grant_micro_credits,
  count(ir.user_id)                                        AS users_joined,
  coalesce(sum(ab.lifetime_spent), 0)::bigint              AS micro_credits_spent,
  coalesce(sum(ab.micro_credits), 0)::bigint               AS micro_credits_remaining,
  coalesce(sum(ab.lifetime_purchased), 0)::bigint          AS micro_credits_purchased,
  min(ir.redeemed_at)                                      AS first_redeemed_at,
  max(ir.redeemed_at)                                      AS last_redeemed_at,
  ic.created_at,
  ic.expires_at,
  ic.starts_at
FROM invite_codes ic
LEFT JOIN invite_redemptions ir ON ir.invite_code_id = ic.id
LEFT JOIN account_balances ab   ON ab.account_id = ir.account_id
GROUP BY ic.id;

-- The invite page asks whether a code works before sending anyone to signup.
-- A per-IP ceiling, so the question cannot be asked fast enough to find codes
-- by guessing: at 20 per 15 minutes, a six-character code from a 31-letter
-- alphabet takes longer to find than the code lives.
INSERT INTO rate_limit_policies (code, description, scope, window_seconds, max_requests)
VALUES ('invite.check', 'Invite codes checked from the invite page, per IP', 'ip', 900, 20)
ON CONFLICT (code, scope, plan_id) DO NOTHING;
