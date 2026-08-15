-- =====================================================================
--  65. THE CATALOG MOVES INTO THE SCHEMA PROPER
--
--  0009 added catalog_versions / models / offerings and said plainly that
--  they overlapped provider_models / feature_model_routes / model_prices on
--  purpose: those were the admin's editable surface, these were the frozen
--  thing customers were served.
--
--  In practice it bought a second source of truth and no freezing. `models`
--  held one JSON document per family that nothing else in the database could
--  join to, so a job's provider_model_id and the catalog entry the customer
--  actually chose from were unrelated facts. And the versioning it existed to
--  provide is already in model_prices: those rows are effective-dated, and
--  jobs.price_id points at the exact row a job's price came from. A quote is
--  held to its price by that reference, not by a snapshot of the whole shop.
--
--  So: provider_models becomes the catalog, grouped by its existing `family`
--  column, with presentation in `capabilities`. quotes moves onto the real
--  keys, and the three app-only tables go.
-- =====================================================================


-- ---------------------------------------------------------------------
--  quotes, onto rows the rest of the schema knows about
--
--  provider_model_id and feature_id are NOT NULL because a quote that cannot
--  name what it is quoting is not a quote. price_id stays nullable until the
--  pricing rows exist — it becomes required in the phase that seeds them.
-- ---------------------------------------------------------------------

-- The columns below are NOT NULL with no default, which an existing row could
-- not satisfy. Failing here with a sentence beats failing on a constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM quotes) THEN
    RAISE EXCEPTION 'quotes is not empty; this migration rewrites its keys and has no backfill'
      USING errcode = '55000';
  END IF;
END
$$;

ALTER TABLE quotes DROP COLUMN catalog_version;
ALTER TABLE quotes DROP COLUMN model_key;

ALTER TABLE quotes ADD COLUMN provider_model_id uuid NOT NULL REFERENCES provider_models(id);
ALTER TABLE quotes ADD COLUMN feature_id        uuid NOT NULL REFERENCES features(id);
ALTER TABLE quotes ADD COLUMN price_id          uuid REFERENCES model_prices(id);

CREATE INDEX quotes_model_idx ON quotes (provider_model_id, created_at DESC);


-- ---------------------------------------------------------------------
--  the app-only catalog goes
--
--  offerings first: it references models. Nothing else does — the only reader
--  of any of the three was PostgresCatalogRepository, which now reads
--  provider_models.
-- ---------------------------------------------------------------------

DROP TABLE offerings;
DROP TABLE models;
DROP TABLE catalog_versions;
