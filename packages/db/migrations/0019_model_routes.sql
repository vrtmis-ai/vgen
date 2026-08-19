-- =====================================================================
--  67. WHERE A CATALOGUE MODEL ACTUALLY RUNS
--
--  Until now the two were the same fact. A variant *is* a `provider_models`
--  row, that row carries a `provider_id`, and so "which provider serves
--  Seedream" was decided by whichever row happened to hold the presentation
--  JSON. Moving a model to a second provider meant editing the catalogue —
--  the same rows the shop, the prices and every past job point at.
--
--  Except the schema already knew better in one place.
--  `unlimited_entitlements.serving_model_id` exists precisely because a job
--  the customer bought as "Nano Banana" can run on a completely different
--  provider's account, and `claim()` has been reading it through a coalesce
--  since 0018. This table generalises that from granted jobs to any job.
--
--  So there are two kinds of `provider_models` row now, and the difference
--  is already enforced elsewhere rather than by a column here:
--
--    * a CATALOGUE row carries `capabilities -> 'variant'`. It is what the
--      customer picks, what `model_prices` prices, and what `jobs` records.
--    * a SERVING row does not. `PostgresCatalogRepository` filters on
--      exactly that key, so a second way to run something never shows up as
--      a second thing to buy.
--
--  A catalogue row with no active route runs itself, which is today's
--  behaviour unchanged. That is why this migration can land with no effect
--  at all: every route seeded alongside it ships inactive, and flipping one
--  is the entire switch.
-- =====================================================================

CREATE TABLE model_routes (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- What the customer bought.
  catalog_model_id  uuid NOT NULL REFERENCES provider_models(id) ON DELETE CASCADE,
  -- What runs it instead.
  serving_model_id  uuid NOT NULL REFERENCES provider_models(id),
  priority          integer NOT NULL DEFAULT 100,   -- lower is tried first
  -- Off by default, and that default is load-bearing. A route seeded by
  -- `pnpm providers:publish` names an upstream model id nobody has yet
  -- proved returns a 200; activating it is a deliberate act by a person,
  -- never a side effect of running the seeder.
  is_active         boolean NOT NULL DEFAULT false,
  -- How this provider's parameters differ from the catalogue row's. Four
  -- operations, applied in order: rename, map, set, drop. Data rather than
  -- code because otherwise every model that moves needs a deploy, and the
  -- whole point of the table is that moving one does not.
  param_overrides   jsonb NOT NULL DEFAULT '{}'::jsonb,
  note              text,
  created_by        uuid REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalog_model_id, serving_model_id),
  -- A row routing to itself is not a route, it is the absence of one, and
  -- it would make the coalesce in claim() read as a no-op that is really a
  -- lookup.
  CONSTRAINT model_routes_not_self CHECK (catalog_model_id <> serving_model_id)
);

-- Two active routes must not tie on priority, or "lowest wins" is a coin
-- flip that resolves differently between two identical jobs.
CREATE UNIQUE INDEX model_routes_priority_idx
  ON model_routes (catalog_model_id, priority) WHERE is_active;

-- The lookup claim() runs on every job.
CREATE INDEX model_routes_catalog_idx
  ON model_routes (catalog_model_id, priority ASC) WHERE is_active;

CREATE TRIGGER model_routes_set_updated_at BEFORE UPDATE ON model_routes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE model_routes IS
  'Which provider_models row actually serves a catalogue variant. No active row means the catalogue row serves itself.';
COMMENT ON COLUMN model_routes.param_overrides IS
  '{"rename":{"from":"to"},"map":{"key":{"from":"to"}},"set":{"key":value},"drop":["key"]} applied in that order before submit.';
