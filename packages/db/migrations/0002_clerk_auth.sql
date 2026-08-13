alter table identities drop constraint if exists identities_provider_check;
alter table identities add constraint identities_provider_check check (provider in ('clerk', 'email'));
