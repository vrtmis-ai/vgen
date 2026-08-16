-- =====================================================================
--  66. UNLIMITED GENERATION, AND THE TIER GATE THAT DECIDES WHO GETS IT
--
--  Two things land together because they are the same decision made at the
--  same moment: when an account asks to run a model, what may it run, and
--  what does this one cost *this* account.
--
--  Until now `plans.tier` and a family's `minTier` both existed and neither
--  was ever compared outside the browser. The padlock in the UI was a
--  suggestion; curl ignored it. Everything here is read on the quote path,
--  server-side, where it becomes a rule.
--
--  The unlimited half exists because not every provider bills per generation.
--  KIE charges per image. A PixVerse Pro+ subscription reached through
--  useapi.net charges a flat monthly fee and then bills nothing per image —
--  it throttles into a slower queue past a daily per-account threshold
--  instead. A model served that way has no marginal cost, so charging coins
--  for it would be charging for something that is free to us.
--
--  That is a genuinely different billing shape, not a discount, which is why
--  it gets its own table rather than a zero row in model_prices. A price of
--  zero would say "this costs nothing"; these rows say "this account may run
--  this, N times a day, and we do not meter it" — a grant with a ceiling.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Which models are free, to whom, and how often
--
--  Two foreign keys into the same table, and the distinction is the whole
--  design:
--
--    catalog_model_id — the row the customer picked. This is the one
--      carrying `capabilities.variant`, the one the catalog renders, the one
--      model_prices has a paid price for.
--
--    serving_model_id — the row that actually runs the job for free. A
--      second provider's copy of the same logical model: same picture, same
--      prompt, different bill.
--
--  Keeping them separate is what stops the catalog growing a duplicate. A
--  serving row is not a catalog entry — it carries no `variant` in its
--  capabilities, and PostgresCatalogRepository skips rows that do not.
--  Without that, "unlimited Nano Banana" would render Nano Banana twice and
--  let the customer pick the wrong one.
--
--  min_tier is compared against plans.tier, the same comparison the paid
--  path makes against a family's minTier. One rule, read in two places,
--  rather than a second notion of access that can disagree with the first.
-- ---------------------------------------------------------------------
CREATE TABLE unlimited_entitlements (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  catalog_model_id  uuid NOT NULL REFERENCES provider_models(id) ON DELETE CASCADE,
  serving_model_id  uuid NOT NULL REFERENCES provider_models(id) ON DELETE CASCADE,
  feature_id        uuid REFERENCES features(id),  -- null = every feature this model serves
  -- The plan tier that unlocks it. Compared against plans.tier; an account
  -- with no plan is tier 1, so min_tier 2 means "paid, Pro or above".
  min_tier          smallint NOT NULL DEFAULT 2
                      CONSTRAINT unlimited_min_tier_check CHECK (min_tier BETWEEN 1 AND 3),
  -- Free generations per account per day. NULL means genuinely uncapped.
  --
  -- A cap is not a walk-back of the word "unlimited" so much as what makes it
  -- survivable: the upstream allowance is a pool shared by every customer, so
  -- one scripted account with no ceiling drains the day for everybody else.
  daily_cap         integer
                      CONSTRAINT unlimited_daily_cap_check CHECK (daily_cap IS NULL OR daily_cap > 0),
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- One free route per catalog model. Two would mean the quote path had to
  -- pick between them, and nothing here says how.
  CONSTRAINT unlimited_entitlements_catalog_key UNIQUE (catalog_model_id),
  -- A model cannot be its own free alternative: that would be a paid row
  -- quietly reclassified as free, which is exactly the confusion these two
  -- columns exist to prevent.
  CONSTRAINT unlimited_entitlements_distinct_check CHECK (catalog_model_id <> serving_model_id)
);

CREATE INDEX unlimited_entitlements_lookup_idx
  ON unlimited_entitlements (catalog_model_id) WHERE is_active;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON unlimited_entitlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------
--  What each account has spent of its daily allowance
--
--  Keyed by entitlement rather than by model so the cap and the counter can
--  never be about different things.
--
--  usage_date is computed in Tehran time by the caller, not by current_date.
--  The customers are Iranian and the server is UTC: a UTC reset lands at
--  03:30 Tehran, which would hand a user a second full allowance in the
--  middle of one evening's session and then none the following evening.
-- ---------------------------------------------------------------------
CREATE TABLE unlimited_usage (
  entitlement_id  uuid NOT NULL REFERENCES unlimited_entitlements(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  usage_date      date NOT NULL,
  used            integer NOT NULL DEFAULT 0
                    CONSTRAINT unlimited_usage_used_check CHECK (used >= 0),
  PRIMARY KEY (entitlement_id, account_id, usage_date)
);

-- Yesterday's counters are dead weight the moment the date rolls; this is
-- what a cleanup job deletes by.
CREATE INDEX unlimited_usage_date_idx ON unlimited_usage (usage_date);


-- ---------------------------------------------------------------------
--  Why a quote was free
--
--  sell_price_micro_credits already permits zero and price_id was already
--  nullable, so a free quote fits the table as it stands — but it would fit
--  silently. A zero-price quote with nothing pointing at the grant that
--  authorised it is indistinguishable from a pricing bug that produced a
--  zero, and the difference matters when the question is "why did we not
--  charge for eleven thousand generations last month".
-- ---------------------------------------------------------------------
ALTER TABLE quotes ADD COLUMN entitlement_id uuid REFERENCES unlimited_entitlements(id);

-- A quote is either priced or granted, never both and never neither.
ALTER TABLE quotes ADD CONSTRAINT quotes_priced_or_granted_check
  CHECK (num_nonnulls(price_id, entitlement_id) = 1);


-- ---------------------------------------------------------------------
--  Jobs record it too
--
--  The quote is the decision; the job is what actually ran. Reading the
--  grant off the quote would work until a quote is cleaned up, and the
--  question "was this job billed" outlives the five minutes a quote lives.
-- ---------------------------------------------------------------------
ALTER TABLE jobs ADD COLUMN entitlement_id uuid REFERENCES unlimited_entitlements(id);

CREATE INDEX jobs_entitlement_idx ON jobs (entitlement_id, created_at DESC)
  WHERE entitlement_id IS NOT NULL;


-- ---------------------------------------------------------------------
--  How busy each upstream account is
--
--  provider_credentials already carries concurrency_limit, weight and
--  last_used_at — it was built for a pool of keys. What it lacked is the
--  shape of a subscription account rather than an API key: useapi.net's
--  guidance is roughly two concurrent creates per connected account before
--  the upstream starts answering 429, and each account keeps its own daily
--  allowance rather than drawing on a shared one.
--
--  daily_request_cap is recorded but deliberately not enforced as a refusal.
--  Past the threshold the upstream does not fail, it slows — and the queue
--  already absorbs slow. It is here so the pool picker can prefer an account
--  with headroom over one that will crawl.
-- ---------------------------------------------------------------------
ALTER TABLE provider_credentials ADD COLUMN daily_request_cap integer
  CONSTRAINT provider_credentials_daily_cap_check
    CHECK (daily_request_cap IS NULL OR daily_request_cap > 0);

-- The pool picker asks this on every claim: the least-loaded active
-- credential for a provider.
CREATE INDEX provider_credentials_pool_idx
  ON provider_credentials (provider_id, last_used_at ASC NULLS FIRST)
  WHERE is_active;
