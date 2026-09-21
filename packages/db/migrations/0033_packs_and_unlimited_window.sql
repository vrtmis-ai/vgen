-- ---------------------------------------------------------------------
--  Packs, and a clock on the unlimited pipe.
--
--  Two decisions by the owner, 2026-09-20, and both of them are about what
--  a plan IS rather than about what it costs.
--
--  1. The four entry plans stop being subscriptions. They are coin packs:
--     the coins never expire, there is no monthly ceiling to run into, and
--     nothing lapses. `term_days = 0` is what says so — the grant path reads
--     it and writes a credit lot with no `expires_at` at all, which is the
--     one place "never expires" is actually enforced. The three main plans
--     keep their thirty days, because that expiry is where the annual price
--     gets its margin.
--
--  2. The unlimited pipe becomes a window rather than a standing perk.
--     Pro carries it for seven days, Studio and Creator for a month. Before
--     this it was open to the top two plans for as long as they held a
--     subscription, which is a free image model with no end — and the free
--     pipe is a shared pool of PixVerse subscriptions, so "no end" is paid
--     for by every other customer's queue.
--
--  Neither the tier column nor `unlimited_entitlements.min_tier` goes away:
--  the perk still needs a floor, and `min_tier` is how the two Nano Banana
--  grants say "paid plans only". What DID go away, in the same change, is
--  the model gate — a family's `minTier` no longer decides whether an
--  account may run it. That lived in `quotesRepository`, not in the schema,
--  so there is nothing to drop here; `provider_models.capabilities.family
--  .minTier` stays as catalogue data the plan cards still read.
-- ---------------------------------------------------------------------

ALTER TABLE plans
  ADD COLUMN unlimited_days smallint NOT NULL DEFAULT 0
    CONSTRAINT plans_unlimited_days_check CHECK (unlimited_days >= 0);

COMMENT ON COLUMN plans.unlimited_days IS
  'Days from the start of a subscription during which unlimited_entitlements apply. 0 = never.';

COMMENT ON COLUMN plans.term_days IS
  'Days a term lasts. 0 = a pack: coins never expire and the membership never lapses.';

-- Existing rows keep thirty days and no window until `pnpm plans:publish`
-- rewrites them from src/data/plans.rows.json, which is the ladder's source.
