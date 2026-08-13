create table frontend_error_reports (
  id bigserial primary key,
  type text not null check (type = 'frontend_crash'),
  release text not null check (length(release) between 1 and 80),
  host text not null check (host = 'web'),
  route text not null check (length(route) between 1 and 256 and left(route, 1) = '/' and position('?' in route) = 0 and position('#' in route) = 0),
  code text not null check (length(code) between 1 and 80),
  request_id text check (request_id is null or length(request_id) between 1 and 128),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index frontend_error_reports_received_idx on frontend_error_reports (received_at desc, id desc);
create index frontend_error_reports_code_route_idx on frontend_error_reports (code, route, received_at desc);
create index frontend_error_reports_request_idx on frontend_error_reports (request_id) where request_id is not null;
create trigger frontend_error_reports_no_mutate before update or delete on frontend_error_reports for each row execute function forbid_mutation();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'app_user') then
    execute 'revoke update, delete on frontend_error_reports from app_user';
  end if;
end
$$;
