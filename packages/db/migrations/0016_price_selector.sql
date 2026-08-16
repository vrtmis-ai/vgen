-- =====================================================================
--  Make model_prices able to hold the prices we actually charge.
--
--  As built, a row is "base + rate x quantity" for one (model, feature).
--  The catalogue does not price that way. Of 44 variants:
--
--    * most pick a flat price from a SETTING — nano-banana-2 is 8/12/18
--      credits at 1K/2K/4K, and one row per (model, feature) has nowhere
--      to say which resolution it means;
--    * fifteen are genuinely per-second, which per_second does express;
--    * six are per-video tiers keyed on resolution AND duration together
--      — wan-2-6, hailuo-2-3, gemini-omni-video and the three veo
--      variants — so per_second cannot express them at any rate;
--    * one combination is not sold at all (hailuo-2-3 at 1080P for 10s).
--      A missing row would read as free, or as an oversight. Neither is
--      what "we do not offer that" means, so it gets to say so.
--
--  Hence `selector`: the settings a price is keyed on, and nothing else.
--  144 rows replace 44, and every price the app quotes today survives —
--  scripts/check-pricing.ts fails the build if any of them moves.
--
--  model_prices is empty, so there is nothing to backfill.
-- =====================================================================

-- The settings this price applies to, e.g. {"resolution":"1080p"}. Only the
-- keys that actually select a rate: adding an irrelevant one would silently
-- stop the row from ever matching. `{}` means the price is unconditional.
ALTER TABLE model_prices ADD COLUMN selector jsonb NOT NULL DEFAULT '{}'::jsonb;

-- False records a combination the provider does not sell. It is not a price of
-- zero and it is not the absence of a price — it is the answer "that cannot be
-- made", which the UI needs in order to disable the button rather than quote.
ALTER TABLE model_prices ADD COLUMN is_offered boolean NOT NULL DEFAULT true;

-- The ceiling on billable units, where the provider caps output below what the
-- caller may supply. Kling Motion Control renders at most 10s from an image and
-- 30s from a video; seconds past that are uploaded, discarded, and must not be
-- charged for. NULL means no cap.
ALTER TABLE model_prices ADD COLUMN max_billable_units numeric(18, 6);

-- One live price per (model, feature, selector) per effective date. NULLS NOT
-- DISTINCT because feature_id is nullable and the default would treat every
-- NULL as unique — which is exactly how you end up with two live prices for one
-- thing and no error to tell you.
CREATE UNIQUE INDEX model_prices_lookup_idx
  ON model_prices (provider_model_id, feature_id, selector, valid_from) NULLS NOT DISTINCT;

-- The lookup the repository actually runs: a model, a feature, and "what is in
-- force now". valid_to IS NULL is the open-ended row.
CREATE INDEX model_prices_effective_idx
  ON model_prices (provider_model_id, feature_id, valid_from DESC)
  WHERE valid_to IS NULL;

COMMENT ON COLUMN model_prices.selector IS
  'Settings this price is keyed on, e.g. {"resolution":"1080p"}. {} = unconditional.';
COMMENT ON COLUMN model_prices.is_offered IS
  'False = the provider does not sell this combination. Distinct from a zero price.';
COMMENT ON COLUMN model_prices.max_billable_units IS
  'Cap on billable units where the provider caps output below the supplied input. NULL = uncapped.';
COMMENT ON COLUMN model_prices.margin_pct IS
  'Markup over provider cost, as a percentage. 100 = charge twice what we pay.';
