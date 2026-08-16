-- =====================================================================
--  Three things the plan ladder needs that `plans` has no column for.
--
--  `plans` was written for billing: what you pay, how long it lasts, how
--  many coins it grants, what caps apply. The ladder in the app also
--  decides what you may RUN and how the card is presented, and neither
--  fits the columns that exist.
--
--  plans is empty, so there is nothing to backfill.
-- =====================================================================

-- The access tier this plan grants. Models declare the minimum tier that
-- unlocks them (`capabilities.family.minTier` on provider_models), so this is
-- one half of a comparison made on every quote — a real column rather than a
-- key in entitlements, because it is read per request and compared, not
-- inspected.
--
-- No plan is tier 1 rather than tier 0: a new account holds a 12-coin signup
-- gift and the cheapest tier-1 models cost about a coin, so tier 1 is what
-- makes that gift a trial someone can actually spend.
ALTER TABLE plans ADD COLUMN tier smallint NOT NULL DEFAULT 1
  CONSTRAINT plans_tier_check CHECK (tier BETWEEN 1 AND 3);

-- Per-month price when twelve months are paid up front. NULL means the plan is
-- not offered annually — the four entry plans are not.
--
-- Deliberately a column on the same row rather than a second plan with
-- term_days = 365. Annual changes the payment cadence, not the grant: coins are
-- still granted monthly and still expire after 30 days, which is where the
-- annual margin comes from. A 365-day row would say the opposite and hand
-- someone twelve months of coins on day one.
ALTER TABLE plans ADD COLUMN annual_price_amount numeric(14, 2)
  CONSTRAINT plans_annual_price_check CHECK (annual_price_amount IS NULL OR annual_price_amount > 0);

-- How the card is presented: which group it sits in and which badge it wears.
-- Kept out of `entitlements`, which is what an account is allowed to do — a
-- column named for one job should not quietly be doing two.
ALTER TABLE plans ADD COLUMN presentation jsonb NOT NULL DEFAULT '{}'::jsonb;

-- The gate's question, asked on every quote: what tier does this account hold?
CREATE INDEX plans_tier_idx ON plans (tier) WHERE is_active;

COMMENT ON COLUMN plans.tier IS
  'Access tier granted. Compared against provider_models.capabilities.family.minTier.';
COMMENT ON COLUMN plans.annual_price_amount IS
  'Per-month price when 12 months are paid up front. NULL = no annual option.';
COMMENT ON COLUMN plans.presentation IS
  'Card presentation only: {"group":"main","tag":"popular","popular":true}.';
COMMENT ON COLUMN plans.price_amount IS
  'List price per month, in `currency`. Stored in USD: the coin economy pivots on USD so a second provider or a Toman rate change does not move it.';
