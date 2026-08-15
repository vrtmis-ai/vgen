-- =====================================================================
--  59. EARLY ACCESS, INVITES AND DISCOUNTS
--
--  DEEV opens invite-only. Two separate mechanisms, deliberately not merged:
--
--    invite_codes  who is allowed to create an account at all
--    promo_codes   what someone pays once they have one
--
--  They are different questions with different lifecycles — the gate comes down
--  when early access ends, the discounts outlive it — and an invite can carry a
--  promo code when a campaign wants both.
--
--  Discounts are not a new table. 0002 already modelled promo_codes and
--  promo_redemptions with redemption caps, a per-account cap, a plan
--  restriction and a date window; this only adds the two things the Iranian
--  market needs that it had no column for.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Invite codes.
--
--  One row serves both cases the product needs:
--
--    kind='campaign'  an admin-generated code with a redemption cap, handed to
--                     a channel — 'apple-deev' capped at 500. The cap and the
--                     spend of everyone who joined through it are what make a
--                     campaign measurable.
--    kind='user'      a member inviting a friend, owned by that member.
--
--  `code` is citext, so 'Apple-DEEV' and 'apple-deev' are the same code. People
--  retype these from posters and screenshots.
-- ---------------------------------------------------------------------
CREATE TABLE invite_codes (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  code                citext NOT NULL UNIQUE,
  label               text,                                  -- 'Apple campaign, Bahman'
  kind                text NOT NULL DEFAULT 'campaign'
                        CHECK (kind IN ('campaign','user')),
  created_by          uuid REFERENCES users(id),             -- the admin, for campaigns
  owner_user_id       uuid REFERENCES users(id),             -- the inviter, for user invites
  max_redemptions     integer CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  redemption_count    integer NOT NULL DEFAULT 0,
  -- Credit the invitee receives on top of any trial. Denominated in
  -- micro-credits like every other money column.
  grant_micro_credits bigint NOT NULL DEFAULT 0 CHECK (grant_micro_credits >= 0),
  grant_expires_days  integer CHECK (grant_expires_days IS NULL OR grant_expires_days > 0),
  -- An invite may also carry a discount on the first purchase.
  promo_code_id       uuid REFERENCES promo_codes(id),
  starts_at           timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz,
  is_active           boolean NOT NULL DEFAULT true,
  revoked_at          timestamptz,
  revoked_by          uuid REFERENCES users(id),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (kind <> 'user' OR owner_user_id IS NOT NULL),
  CHECK (redemption_count >= 0),
  -- The cap is enforced here as well as in the redemption path. A race between
  -- two signups on the last seat has to lose at the constraint, not at a count
  -- read a moment earlier.
  CHECK (max_redemptions IS NULL OR redemption_count <= max_redemptions)
);
CREATE INDEX invite_codes_active_idx ON invite_codes (expires_at) WHERE is_active AND revoked_at IS NULL;
CREATE INDEX invite_codes_owner_idx ON invite_codes (owner_user_id) WHERE owner_user_id IS NOT NULL;
CREATE TRIGGER invite_codes_set_updated_at BEFORE UPDATE ON invite_codes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------
--  Who joined through which code.
--
--  UNIQUE on user_id: an account is admitted by exactly one invite. Without it
--  the same signup could be attributed to two campaigns and both would claim
--  the credit.
--
--  Never cascades from invite_codes. Deleting a code must not erase the record
--  of who it let in — that record is the campaign's result, and it is also how
--  an abusive inviter is traced after the fact.
-- ---------------------------------------------------------------------
CREATE TABLE invite_redemptions (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  invite_code_id uuid NOT NULL REFERENCES invite_codes(id),
  user_id        uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  lot_id         uuid REFERENCES credit_lots(id) ON DELETE SET NULL,
  ip             inet,
  redeemed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_redemptions_code_idx ON invite_redemptions (invite_code_id, redeemed_at DESC);

-- Counter maintained in the database, matching how every other count in this
-- schema is kept. An application-side increment would drift the moment one
-- redemption path forgets it.
CREATE OR REPLACE FUNCTION bump_invite_redemption_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE invite_codes SET redemption_count = redemption_count + 1 WHERE id = NEW.invite_code_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE invite_codes SET redemption_count = greatest(redemption_count - 1, 0) WHERE id = OLD.invite_code_id;
  END IF;
  RETURN NULL;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER invite_redemptions_counter
  AFTER INSERT OR DELETE ON invite_redemptions
  FOR EACH ROW EXECUTE FUNCTION bump_invite_redemption_count();


-- ---------------------------------------------------------------------
--  Discounts: the two columns promo_codes was missing.
--
--  `amount_off` is a flat sum in the order's currency. Plans are priced in
--  large round IRR figures, and "۲۰۰٬۰۰۰ تومان off" is what a customer
--  understands from an advert; expressing that as a percentage gives a
--  different discount on every plan.
--
--  `first_purchase_only` restricts a code to an account that has never paid,
--  which is the difference between an acquisition offer and a permanent
--  discount for existing customers.
-- ---------------------------------------------------------------------
ALTER TABLE promo_codes
  ADD COLUMN label               text,
  ADD COLUMN amount_off          numeric(14,2) CHECK (amount_off IS NULL OR amount_off > 0),
  ADD COLUMN currency            text NOT NULL DEFAULT 'IRR',
  ADD COLUMN first_purchase_only boolean NOT NULL DEFAULT false,
  ADD COLUMN revoked_at          timestamptz,
  ADD COLUMN revoked_by          uuid REFERENCES users(id);

ALTER TABLE promo_codes DROP CONSTRAINT promo_codes_kind_check;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_kind_check
  CHECK (kind IN ('credits','percent_off','amount_off','free_term'));

-- Each kind carries exactly the field it needs, so a code cannot be created
-- that names a discount it has no value for.
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_kind_value_check CHECK (
  (kind = 'credits'    AND micro_credits > 0)
  OR (kind = 'percent_off' AND percent_off IS NOT NULL)
  OR (kind = 'amount_off'  AND amount_off IS NOT NULL)
  OR (kind = 'free_term'   AND plan_id IS NOT NULL)
);


-- ---------------------------------------------------------------------
--  The gate itself.
--
--  A feature_flags row rather than a new table: turning early access off at
--  launch is then one UPDATE, and the flag is already the thing the admin panel
--  reads for everything else.
-- ---------------------------------------------------------------------
INSERT INTO feature_flags (code, description, is_enabled, rules)
VALUES (
  'early_access',
  'Signup requires a valid invite code while this is enabled.',
  true,
  '{"invite_required": true}'::jsonb
)
ON CONFLICT (code) DO NOTHING;


-- ---------------------------------------------------------------------
--  60. CAMPAIGN REPORTING
--
--  "How many people used this code, and how many credits did they spend."
--
--  The spend figure is not new bookkeeping: account_balances.lifetime_spent is
--  already maintained by capture_hold for every account, so a campaign's return
--  is a join rather than a second counter that can disagree with the ledger.
-- ---------------------------------------------------------------------
CREATE VIEW v_invite_performance AS
SELECT
  ic.id,
  ic.code,
  ic.label,
  ic.kind,
  ic.is_active AND ic.revoked_at IS NULL
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
  ic.created_at
FROM invite_codes ic
LEFT JOIN invite_redemptions ir ON ir.invite_code_id = ic.id
LEFT JOIN account_balances ab   ON ab.account_id = ir.account_id
GROUP BY ic.id;

CREATE VIEW v_promo_performance AS
SELECT
  pc.id,
  pc.code,
  pc.label,
  pc.kind,
  pc.is_active AND pc.revoked_at IS NULL
    AND (pc.expires_at IS NULL OR pc.expires_at > now())
    AND (pc.max_redemptions IS NULL OR pc.redemption_count < pc.max_redemptions) AS is_usable,
  pc.revoked_at,
  pc.max_redemptions,
  pc.redemption_count,
  pc.micro_credits,
  pc.percent_off,
  pc.amount_off,
  pc.first_purchase_only,
  count(pr.id)                                             AS redemptions,
  count(DISTINCT pr.account_id)                            AS accounts,
  coalesce(sum(o.amount), 0)::numeric(14,2)                AS order_amount,
  coalesce(sum(ab.lifetime_spent), 0)::bigint              AS micro_credits_spent,
  min(pr.redeemed_at)                                      AS first_redeemed_at,
  max(pr.redeemed_at)                                      AS last_redeemed_at,
  pc.created_at
FROM promo_codes pc
LEFT JOIN promo_redemptions pr ON pr.promo_code_id = pc.id
LEFT JOIN orders o             ON o.id = pr.order_id AND o.status = 'paid'
LEFT JOIN account_balances ab  ON ab.account_id = pr.account_id
GROUP BY pc.id;


-- ---------------------------------------------------------------------
--  61. REDEEMING AN INVITE
--
--  One function, because admitting an account touches four things that must
--  agree: the code's cap, the record of who used it, the credit it carries, and
--  the referral row when a member did the inviting.
--
--  Raises rather than returning a status, so a caller cannot ignore the result
--  and create the account anyway:
--    22023 invalid_parameter_value  no such code
--    23514 check_violation          revoked, expired, inactive, or full
--    23505 unique_violation         this user already used an invite
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION redeem_invite(
  p_code       citext,
  p_user_id    uuid,
  p_account_id uuid,
  p_ip         inet DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_invite record;
  v_lot_id uuid;
  v_redemption_id uuid;
BEGIN
  -- FOR UPDATE is what makes the cap hold under concurrent signups: two people
  -- racing for the last seat serialise here instead of both reading the same
  -- count and both passing.
  SELECT * INTO v_invite FROM invite_codes WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invite_not_found: %', p_code USING errcode = '22023';
  END IF;

  IF NOT v_invite.is_active OR v_invite.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'invite_revoked: %', p_code USING errcode = '23514';
  END IF;
  IF v_invite.starts_at > now() THEN
    RAISE EXCEPTION 'invite_not_started: %', p_code USING errcode = '23514';
  END IF;
  IF v_invite.expires_at IS NOT NULL AND v_invite.expires_at <= now() THEN
    RAISE EXCEPTION 'invite_expired: %', p_code USING errcode = '23514';
  END IF;
  IF v_invite.max_redemptions IS NOT NULL AND v_invite.redemption_count >= v_invite.max_redemptions THEN
    RAISE EXCEPTION 'invite_exhausted: %', p_code USING errcode = '23514';
  END IF;
  IF v_invite.owner_user_id = p_user_id THEN
    RAISE EXCEPTION 'invite_self_redemption: %', p_code USING errcode = '23514';
  END IF;

  -- Credit first, so the lot id can be recorded on the redemption and an
  -- operator can see exactly which grant a campaign paid for.
  IF v_invite.grant_micro_credits > 0 THEN
    v_lot_id := grant_credits(
      p_account_id,
      CASE WHEN v_invite.kind = 'user' THEN 'referral' ELSE 'promo' END,
      v_invite.grant_micro_credits,
      CASE WHEN v_invite.grant_expires_days IS NULL THEN NULL
           ELSE now() + (v_invite.grant_expires_days * interval '1 day') END,
      'Invite ' || v_invite.code,
      v_invite.created_by,
      'invite',
      v_invite.id
    );
  END IF;

  INSERT INTO invite_redemptions (invite_code_id, user_id, account_id, lot_id, ip)
  VALUES (v_invite.id, p_user_id, p_account_id, v_lot_id, p_ip)
  RETURNING id INTO v_redemption_id;

  -- A member's invite is also a referral. It stays 'pending' until the invitee
  -- actually pays, which is 0002's anti-farming design and the reason the
  -- inviter's reward is not granted here.
  IF v_invite.kind = 'user' THEN
    INSERT INTO referrals (referrer_user_id, referred_user_id, code, status)
    VALUES (v_invite.owner_user_id, p_user_id, v_invite.code::text, 'pending')
    ON CONFLICT (referred_user_id) DO NOTHING;
  END IF;

  RETURN v_redemption_id;
END
$$ LANGUAGE plpgsql;
