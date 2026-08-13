create extension if not exists pgcrypto;

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end
$$ language plpgsql;

create or replace function forbid_mutation() returns trigger as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '55000';
end
$$ language plpgsql;

create table users (
  id uuid primary key default gen_random_uuid(),
  display_name text,
  avatar_url text,
  locale text not null default 'fa',
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  is_team boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger users_set_updated_at before update on users for each row execute function set_updated_at();

create table identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('clerk','email')),
  subject text not null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, subject)
);
create index identities_user_idx on identities (user_id);

create table credit_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('plan','signup_gift','reward','referral','admin','compensation')),
  amount bigint not null check (amount > 0),
  consumed bigint not null default 0 check (consumed >= 0 and consumed <= amount),
  granted_at timestamptz not null default now(),
  expires_at timestamptz,
  source_type text,
  source_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index credit_grants_spendable_idx on credit_grants (user_id, expires_at nulls last, granted_at) where consumed < amount;

create table credit_ledger (
  id bigserial primary key,
  user_id uuid not null references users(id),
  grant_id uuid references credit_grants(id),
  delta bigint not null check (delta <> 0),
  reason text not null check (reason in (
    'grant_plan','grant_signup_gift','grant_reward','grant_referral','grant_admin',
    'job_hold','job_settle_extra','job_settle_refund','job_refund_failed',
    'job_refund_cancelled','expire','admin_debit'
  )),
  ref_type text,
  ref_id uuid,
  idempotency_key text not null,
  actor_type text not null default 'system' check (actor_type in ('system','user','admin')),
  actor_id uuid,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index credit_ledger_user_idx on credit_ledger (user_id, id desc);
create index credit_ledger_ref_idx on credit_ledger (ref_type, ref_id);
create trigger credit_ledger_no_mutate before update or delete on credit_ledger for each row execute function forbid_mutation();

create table plans (
  id text not null,
  version int not null,
  name text not null,
  tier smallint not null,
  credits_per_cycle bigint not null check (credits_per_cycle > 0),
  cycle_days int not null check (cycle_days > 0),
  grant_ttl_days int not null check (grant_ttl_days > 0),
  price_usd_micros bigint not null check (price_usd_micros > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (id, version)
);
create unique index plans_active_idx on plans (id) where active;

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind = 'plan'),
  plan_id text,
  plan_version int,
  cycle text check (cycle is null or cycle in ('monthly','annual')),
  amount_irr bigint not null check (amount_irr > 0),
  usd_rate_irr bigint not null check (usd_rate_irr > 0),
  status text not null check (status in ('created','pending','paid','failed','expired','refunded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  paid_at timestamptz,
  foreign key (plan_id, plan_version) references plans(id, version),
  check ((plan_id is null) = (plan_version is null))
);
create index orders_user_idx on orders (user_id, created_at desc);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  plan_id text not null,
  plan_version int not null,
  cycle text not null check (cycle in ('monthly','annual')),
  cycles_total int not null check (cycles_total > 0),
  cycles_granted int not null default 0 check (cycles_granted >= 0 and cycles_granted <= cycles_total),
  next_grant_at timestamptz,
  status text not null check (status in ('active','completed','cancelled')),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  order_id uuid not null unique references orders(id),
  created_at timestamptz not null default now(),
  foreign key (plan_id, plan_version) references plans(id, version)
);
create index subscriptions_due_idx on subscriptions (next_grant_at) where status = 'active' and next_grant_at is not null;

create table payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  gateway text not null,
  authority text,
  amount_irr bigint not null check (amount_irr > 0),
  status text not null check (status in ('created','redirected','verified','duplicate','failed')),
  gateway_ref_id text,
  raw_request jsonb,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (gateway, authority)
);

create table catalog_versions (
  id int primary key generated always as identity,
  published_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

create table models (
  catalog_version int not null references catalog_versions(id),
  key text not null,
  family text not null,
  kind text not null check (kind in ('image','video','audio')),
  min_tier smallint not null,
  max_prompt int,
  no_prompt boolean not null default false,
  spec jsonb not null,
  active boolean not null default true,
  primary key (catalog_version, key)
);

create table offerings (
  catalog_version int not null,
  model_key text not null,
  provider text not null,
  provider_model text not null,
  rate jsonb not null,
  priority smallint not null default 100,
  active boolean not null default true,
  primary key (catalog_version, model_key, provider),
  foreign key (catalog_version, model_key) references models(catalog_version, key)
);
create index offerings_model_idx on offerings (catalog_version, model_key);

create table config (
  key text primary key,
  value jsonb not null,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create trigger config_set_updated_at before update on config for each row execute function set_updated_at();

create table config_history (
  id bigserial primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index config_history_key_idx on config_history (key, changed_at desc);
create trigger config_history_no_mutate before update or delete on config_history for each row execute function forbid_mutation();

create table quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  catalog_version int not null,
  model_key text not null,
  params_hash bytea not null,
  provider_cost_usd_micros bigint not null check (provider_cost_usd_micros >= 0),
  sell_price_credits bigint not null check (sell_price_credits >= 0),
  exchange_rate_irr_per_usd bigint not null check (exchange_rate_irr_per_usd > 0),
  margin_usd_micros bigint not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key (catalog_version, model_key) references models(catalog_version, key)
);
create index quotes_user_expiry_idx on quotes (user_id, expires_at);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  quote_id uuid not null unique references quotes(id),
  status text not null check (status in ('queued','submitted','running','succeeded','failed','cancelled','expired')),
  catalog_version int not null,
  model_key text not null,
  params jsonb not null,
  params_hash bytea not null,
  idempotency_key text not null,
  quoted_credits bigint not null check (quoted_credits >= 0),
  held_credits bigint not null check (held_credits >= 0),
  settled_credits bigint check (settled_credits is null or settled_credits >= 0),
  provider text,
  provider_task_id text,
  provider_cost_usd_micros bigint check (provider_cost_usd_micros is null or provider_cost_usd_micros >= 0),
  attempts smallint not null default 0 check (attempts >= 0),
  error_code text,
  error_message text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (catalog_version, model_key) references models(catalog_version, key)
);
create unique index jobs_provider_task_idx on jobs (provider, provider_task_id) where provider_task_id is not null;
create index jobs_user_idx on jobs (user_id, created_at desc);
create index jobs_active_idx on jobs (status, updated_at) where status in ('queued','submitted','running');
create trigger jobs_set_updated_at before update on jobs for each row execute function set_updated_at();

create table job_events (
  id bigserial primary key,
  job_id uuid not null references jobs(id),
  at timestamptz not null default now(),
  from_status text,
  to_status text,
  source text not null check (source in ('api','worker','webhook','poller','admin')),
  payload jsonb
);
create index job_events_job_idx on job_events (job_id, id);
create trigger job_events_no_mutate before update or delete on job_events for each row execute function forbid_mutation();

create table assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  job_id uuid references jobs(id),
  kind text not null check (kind in ('image','video','audio')),
  role text not null check (role in ('input','output','thumbnail','poster')),
  storage_key text not null unique,
  bytes bigint not null check (bytes >= 0),
  mime text not null,
  sha256 bytea not null,
  phash bytea,
  width int check (width is null or width > 0),
  height int check (height is null or height > 0),
  duration_ms int check (duration_ms is null or duration_ms >= 0),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index assets_user_idx on assets (user_id, created_at desc) where deleted_at is null;
create index assets_job_idx on assets (job_id);
create index assets_phash_idx on assets (phash) where phash is not null;

create table reward_rules (
  key text primary key,
  credits bigint not null check (credits > 0),
  ttl_days int,
  repeatable boolean not null default false,
  max_claims int,
  active boolean not null default true,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check (not repeatable or max_claims is not null)
);

create table reward_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  rule_key text not null references reward_rules(key),
  grant_id uuid references credit_grants(id),
  seq int not null default 1 check (seq > 0),
  created_at timestamptz not null default now(),
  unique (user_id, rule_key, seq)
);

create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references users(id),
  referred_user_id uuid not null unique references users(id),
  code text not null,
  qualified_at timestamptz,
  grant_id uuid references credit_grants(id),
  created_at timestamptz not null default now(),
  check (referrer_user_id <> referred_user_id)
);
create index referrals_referrer_idx on referrals (referrer_user_id);

create table community_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  kind text not null check (kind in ('image','video','montage')),
  job_id uuid references jobs(id),
  asset_id uuid not null unique references assets(id),
  prompt text,
  model_key text,
  params jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','removed')),
  consent_at timestamptz not null,
  match_score numeric(5,2),
  matched_jobs uuid[],
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  check (kind = 'montage' or job_id is not null)
);
create index community_feed_idx on community_posts (status, created_at desc) where status = 'approved';
create index community_queue_idx on community_posts (created_at) where status = 'pending';

create table admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('viewer','operator','owner')),
  totp_secret bytea not null,
  disabled_at timestamptz,
  created_at timestamptz not null default now()
);

create table admin_audit_log (
  id bigserial primary key,
  admin_id uuid not null references admin_users(id),
  at timestamptz not null default now(),
  action text not null,
  target_type text,
  target_id text,
  before jsonb,
  after jsonb,
  reason text,
  ip inet,
  request_id text
);
create index admin_audit_target_idx on admin_audit_log (target_type, target_id, at desc);
create trigger admin_audit_log_no_mutate before update or delete on admin_audit_log for each row execute function forbid_mutation();

create table outbox (
  id bigserial primary key,
  aggregate text not null,
  aggregate_id uuid not null,
  event_type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  attempts smallint not null default 0 check (attempts >= 0),
  last_error text,
  unique (aggregate, aggregate_id, event_type)
);
create index outbox_pending_idx on outbox (id) where published_at is null;

create table idempotency_keys (
  key text primary key,
  user_id uuid not null references users(id),
  endpoint text not null,
  request_hash bytea not null,
  status text not null check (status in ('in_progress','completed')),
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index idempotency_keys_expiry_idx on idempotency_keys (expires_at);

create table provider_health (
  provider text primary key,
  balance_usd_micros bigint check (balance_usd_micros is null or balance_usd_micros >= 0),
  balance_at timestamptz,
  error_rate_5m numeric(5,4),
  p95_latency_ms int,
  state text not null default 'closed' check (state in ('closed','half_open','open')),
  state_changed_at timestamptz,
  updated_at timestamptz not null default now()
);
create trigger provider_health_set_updated_at before update on provider_health for each row execute function set_updated_at();

create table webhook_deliveries (
  id bigserial primary key,
  provider text not null,
  external_id text not null,
  timestamp_s bigint not null,
  received_at timestamptz not null default now(),
  accepted boolean not null,
  reason text,
  unique (provider, external_id, timestamp_s)
);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'revoke update, delete on credit_ledger, job_events, config_history, admin_audit_log from app_user';
  end if;
end
$$;
