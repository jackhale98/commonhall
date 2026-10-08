-- Phase 5: state legislators and current-session state bills (trimmed to
-- essentials), and a cache for address lookups.

create table public.state_legislators (
  id text primary key check (id like 'ocd-person/%'),
  name text not null,
  party text,
  state char(2) not null,
  chamber text check (chamber in ('upper', 'lower', 'legislature')),
  district text,
  title text,
  photo_url text,
  email text,
  openstates_url text,
  current boolean not null default true,
  updated_at timestamptz
);

create index state_legislators_state_idx on public.state_legislators (state, chamber, district) where current;

create table public.state_bills (
  id text primary key check (id like 'ocd-bill/%'),
  state char(2) not null,
  session text not null,
  identifier text not null,
  title text not null,
  chamber text check (chamber in ('upper', 'lower', 'legislature')),
  classification text,
  first_action_date date,
  latest_action_date date,
  latest_action_text text,
  latest_passage_date date,
  primary_sponsor_id text,
  primary_sponsor_name text,
  openstates_url text,
  updated_at timestamptz,
  synced_at timestamptz not null default now()
);

comment on column public.state_bills.primary_sponsor_id is 'Open States person id; may not be in state_legislators (former members).';
comment on column public.state_bills.updated_at is 'Open States updated_at, the incremental cursor.';

create index state_bills_state_latest_idx on public.state_bills (state, latest_action_date desc nulls last);
create index state_bills_sponsor_idx on public.state_bills (primary_sponsor_id) where primary_sponsor_id is not null;

-- Address lookups, keyed by coordinates rounded to ~100 m. Addresses themselves are never stored.
create table public.geo_cache (
  key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);

alter table public.state_legislators enable row level security;
alter table public.state_bills enable row level security;
alter table public.geo_cache enable row level security;
create policy "Public read" on public.state_legislators for select to anon, authenticated using (true);
create policy "Public read" on public.state_bills for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_legislators, public.state_bills from anon, authenticated;

-- Requests to an API since a time (for daily budgets).
create or replace function public.api_usage_since(p_api text, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(requests), 0)::integer from public.api_usage where api = p_api and hour >= date_trunc('hour', p_since);
$$;

revoke all on function public.api_usage_since(text, timestamptz) from public, anon, authenticated;
grant execute on function public.api_usage_since(text, timestamptz) to service_role;

-- api_usage rows older than 60 days are not needed for any budget.
select cron.schedule('purge-api-usage', '19 3 * * *', $$delete from public.api_usage where hour < now() - interval '60 days'$$);
select cron.schedule('purge-geo-cache', '23 3 * * *', $$delete from public.geo_cache where expires_at < now()$$);

-- Nightly state sync: several short runs between 1 and 6 a.m. Eastern so each stays
-- inside the Edge Function time limit while working through the daily budget.
select cron.schedule('sync-state', '7,37 6-10 * * *', $$select private.invoke_sync('sync-state')$$);
