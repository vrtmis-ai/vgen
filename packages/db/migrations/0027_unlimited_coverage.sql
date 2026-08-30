-- ---------------------------------------------------------------------
--  Which settings the free pipe actually covers
--
--  A grant in unlimited_entitlements says a variant can be served by a
--  subscription account instead of a metered one. It does not say that every
--  setting of that variant can be: the subscription serves Nano Banana up to
--  2K, and a 4K image goes back through the metered pipe at the metered price.
--
--  Without somewhere to record that, a screen can only find out by asking for
--  a quote and reading the price that comes back — which means the customer
--  flips a switch labelled free, generates, and is charged. That is the
--  failure this column exists to prevent, and it is a money failure rather
--  than a cosmetic one, so it belongs in the row that authorises the grant.
--
--  Shape is `control key -> the values the pipe covers`, matching the control
--  keys in provider_models.capabilities:
--
--      {"resolution": ["1K", "2K"]}
--
--  NULL means the pipe covers every setting the variant offers, which is the
--  ordinary case and the reason this is nullable rather than defaulted to an
--  empty object — `{}` would read as "covers nothing".
--
--  A key absent from the object is unconstrained. Only the settings named here
--  are narrowed, so adding a control to a variant does not silently withdraw
--  its grant.
-- ---------------------------------------------------------------------
ALTER TABLE unlimited_entitlements ADD COLUMN covers jsonb
  CONSTRAINT unlimited_covers_shape_check
    CHECK (covers IS NULL OR jsonb_typeof(covers) = 'object');

COMMENT ON COLUMN unlimited_entitlements.covers IS
  'control key -> allowed values for the free pipe; NULL means every setting';
