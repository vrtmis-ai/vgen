-- =====================================================================
--  Application tables the deev-db schema does not carry.
--
--  0001-0008 are the deev-db schema as designed. This file adds the five
--  things the running application needs that that schema has no equivalent
--  for, plus one fix carried forward from the schema it replaced.
--
--  Conventions follow the files above: UUIDv7 primary keys, CHECK pseudo-enums
--  rather than PG enum types, ownership on accounts rather than users.
-- =====================================================================


-- ---------------------------------------------------------------------
--  53. APPEND-ONLY ENFORCEMENT
--
--  deev-db makes credit_ledger append-only with two ON UPDATE/DELETE DO INSTEAD
--  NOTHING rules and a REVOKE. Neither covers TRUNCATE: it is its own privilege
--  in Postgres, so revoking DELETE does not revoke it, and rules do not fire for
--  it because it never touches a row. `TRUNCATE credit_ledger` would therefore
--  empty the money ledger with both guards silent.
--
--  Statement-level triggers do fire on TRUNCATE. This is the same hole, and the
--  same fix, that the previous schema closed in its own 0005.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', tg_table_name USING errcode = '55000';
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER credit_ledger_no_truncate
  BEFORE TRUNCATE ON credit_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- The trigger is the real guarantee — it binds the table owner too, who cannot
-- be stopped by a revoke. Taking the grant away as well means the ordinary app
-- role fails at permission-check time rather than inside a trigger.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deev_app') THEN
    EXECUTE 'REVOKE TRUNCATE ON credit_ledger, audit_log FROM deev_app';
  END IF;
END
$$;


-- ---------------------------------------------------------------------
--  54. PUBLISHED CATALOG
--
--  An immutable snapshot of what is on sale, which the web app reads as one
--  CatalogSnapshot document. `models.spec` holds the whole CatalogFamily the
--  browser renders, so adding a control or a variant is a publish, not a
--  migration.
--
--  This overlaps deliberately with provider_models / feature_model_routes /
--  model_prices above, and the two are not redundant: those are the admin's
--  editable routing and pricing surface, this is the frozen thing customers
--  were served. A published version is never edited — republish instead — which
--  is what lets a quote reference the exact prices its price was derived from.
-- ---------------------------------------------------------------------

CREATE TABLE catalog_versions (
  id           int PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  published_at timestamptz,              -- null = draft
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalog_versions_published_idx ON catalog_versions (published_at DESC) WHERE published_at IS NOT NULL;

CREATE TABLE models (
  catalog_version int NOT NULL REFERENCES catalog_versions(id),
  key             text NOT NULL,
  family          text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('image','video','audio')),
  min_tier        smallint NOT NULL,
  max_prompt      int,
  no_prompt       boolean NOT NULL DEFAULT false,
  spec            jsonb NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (catalog_version, key)
);

CREATE TABLE offerings (
  catalog_version int NOT NULL,
  model_key       text NOT NULL,
  provider        text NOT NULL,
  provider_model  text NOT NULL,
  rate            jsonb NOT NULL,
  priority        smallint NOT NULL DEFAULT 100,
  active          boolean NOT NULL DEFAULT true,
  PRIMARY KEY (catalog_version, model_key, provider),
  FOREIGN KEY (catalog_version, model_key) REFERENCES models(catalog_version, key)
);
CREATE INDEX offerings_model_idx ON offerings (catalog_version, model_key);


-- ---------------------------------------------------------------------
--  55. QUOTES
--
--  A price the server derived, held for a short window so the customer is
--  charged what they were shown.
--
--  It exists because a price the browser sends is a price the customer can
--  edit. Submitting a job names a quote id and never a number, and the amount
--  actually held comes from this row.
--
--  Stored in micro-credits like every other money column (1 credit = 1e6).
-- ---------------------------------------------------------------------

CREATE TABLE quotes (
  id                         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  account_id                 uuid NOT NULL REFERENCES accounts(id),
  created_by                 uuid REFERENCES users(id),
  catalog_version            int NOT NULL,
  model_key                  text NOT NULL,
  params_hash                bytea NOT NULL,
  provider_cost_usd_micros   bigint NOT NULL CHECK (provider_cost_usd_micros >= 0),
  sell_price_micro_credits   bigint NOT NULL CHECK (sell_price_micro_credits >= 0),
  exchange_rate_irr_per_usd  bigint NOT NULL CHECK (exchange_rate_irr_per_usd > 0),
  margin_usd_micros          bigint NOT NULL,
  expires_at                 timestamptz NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (catalog_version, model_key) REFERENCES models(catalog_version, key)
);
CREATE INDEX quotes_account_expiry_idx ON quotes (account_id, expires_at);

-- The job that consumed a quote. deev-db's jobs table has no such column
-- because it had no quotes; without it a quote could be spent twice.
ALTER TABLE jobs ADD COLUMN quote_id uuid REFERENCES quotes(id);
CREATE UNIQUE INDEX jobs_quote_idx ON jobs (quote_id) WHERE quote_id IS NOT NULL;


-- ---------------------------------------------------------------------
--  56. RUNTIME CONFIG
--
--  Values an operator changes without a deploy, with an append-only trail of
--  who changed what. Distinct from app_settings above, which is the same idea
--  for values the schema itself depends on.
-- ---------------------------------------------------------------------

CREATE TABLE config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER config_set_updated_at BEFORE UPDATE ON config
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE config_history (
  id         bigserial PRIMARY KEY,
  key        text NOT NULL,
  old_value  jsonb,
  new_value  jsonb,
  changed_by uuid REFERENCES users(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX config_history_key_idx ON config_history (key, changed_at DESC);
CREATE TRIGGER config_history_no_mutate BEFORE UPDATE OR DELETE ON config_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER config_history_no_truncate BEFORE TRUNCATE ON config_history
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();


-- ---------------------------------------------------------------------
--  57. FRONTEND CRASH REPORTS
--
--  Sanitized browser crash beacons. The CHECK constraints are the point: this
--  table is a whitelist by construction, with no column a prompt, a message or
--  a stack trace could arrive in, so a crash report cannot carry user content
--  even if the client is changed to send it.
-- ---------------------------------------------------------------------

CREATE TABLE frontend_error_reports (
  id          bigserial PRIMARY KEY,
  type        text NOT NULL CHECK (type = 'frontend_crash'),
  release     text NOT NULL CHECK (length(release) BETWEEN 1 AND 80),
  host        text NOT NULL CHECK (host = 'web'),
  route       text NOT NULL CHECK (
                length(route) BETWEEN 1 AND 256
                AND left(route, 1) = '/'
                AND position('?' IN route) = 0
                AND position('#' IN route) = 0
              ),
  code        text NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
  request_id  text CHECK (request_id IS NULL OR length(request_id) BETWEEN 1 AND 128),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX frontend_error_reports_received_idx ON frontend_error_reports (received_at DESC, id DESC);
CREATE INDEX frontend_error_reports_code_route_idx ON frontend_error_reports (code, route, received_at DESC);
CREATE INDEX frontend_error_reports_request_idx ON frontend_error_reports (request_id) WHERE request_id IS NOT NULL;
CREATE TRIGGER frontend_error_reports_no_mutate BEFORE UPDATE OR DELETE ON frontend_error_reports
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER frontend_error_reports_no_truncate BEFORE TRUNCATE ON frontend_error_reports
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'deev_app') THEN
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON config_history, frontend_error_reports FROM deev_app';
  END IF;
END
$$;
