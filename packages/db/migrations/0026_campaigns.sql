-- =====================================================================
--  0026 — the campaign window the plans strip counts down to
--
--  `GET /campaigns/active` has been a 404 since the strip was built. The
--  frontend half shipped complete — the adapter, the contract, the
--  countdown — and the route it calls did not exist, so production mode
--  got a rejected query and the strip rendered nothing.
--
--  What is missing is exactly one fact: WHEN the festival ends. Every
--  other number the strip prints is already in `plans` and is already
--  what checkout charges, so it is derived rather than stored — see
--  campaignsRepository.ts for why that is not laziness but the whole
--  point of the contract.
--
--  A table rather than a `feature_flags` row, which is how `early_access`
--  does the same job. Three reasons, and none of them is symmetry:
--
--    * `ends_at` is the one value in this product that must be a real
--      instant. A jsonb string that fails to parse gives the browser a
--      NaN countdown — which is a more elaborate version of the exact
--      bug this route was created to remove.
--    * Campaigns recur. Nowruz, Yalda and a launch sale are three rows,
--      and the next one wants scheduling before this one ends. A single
--      flag row is edited in place and forgets what ran when.
--    * "Which campaign was running when this order was placed" is a
--      question the books will ask, and it is a join to a row.
-- =====================================================================

-- No BEGIN/COMMIT here: `migrate.ts` already runs each file inside
-- `sql.begin(...)` together with its `schema_migrations` row. Opening a second
-- one warns, and its COMMIT ends the runner's transaction early — which leaves
-- the DDL applied and unrecorded if the bookkeeping insert then fails.

CREATE TABLE campaigns (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  -- What the browser receives as `id`. Human-meaningful on purpose: this
  -- ends up in analytics beside orders, and 'nowruz-1405' answers the
  -- question a uuid makes you look up.
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT campaigns_window_check CHECK (ends_at > starts_at),
  -- Two campaigns running at once is a data error, not a tie to break.
  -- The strip has room for one offer and would silently show whichever
  -- the planner happened to return first; this makes the second INSERT
  -- fail at the moment somebody makes the mistake, which is the only
  -- time it can still be fixed cheaply.
  CONSTRAINT campaigns_no_overlap EXCLUDE USING gist (tstzrange(starts_at, ends_at) WITH &&)
);

-- The lookup is "is one running right now", asked on every page load of
-- the plans screen by every anonymous visitor.
CREATE INDEX campaigns_window_idx ON campaigns (ends_at DESC, starts_at);

COMMENT ON TABLE campaigns IS
  'Time-boxed promotional windows. The strip prints numbers derived from `plans`; this table supplies only the window.';
COMMENT ON COLUMN campaigns.code IS
  'Stable public identifier, served to the browser as the campaign id. e.g. ''nowruz-1405''.';
COMMENT ON COLUMN campaigns.ends_at IS
  'Absolute instant the offer stops. Served as epoch milliseconds; never as a remaining duration.';

-- No seed row, and that is deliberate rather than unfinished. An empty
-- table means `GET /campaigns/active` answers null and the strip does not
-- render — which is both the ordinary state of the year and the current
-- behaviour of the site. Whether a festival is running is a decision for
-- whoever sells the plans, and seeding one here would put a countdown on
-- the live site because a migration ran.
