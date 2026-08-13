alter table outbox
  add column available_at timestamptz not null default now(),
  add column dead_lettered_at timestamptz;

drop index outbox_pending_idx;
create index outbox_pending_idx on outbox (available_at, id)
where published_at is null and dead_lettered_at is null;
