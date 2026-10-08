-- Phase 2: cache for bills and members fetched on demand (older Congresses, or
-- bills not yet synced). Written and read only by the fetch-on-demand function.

create table public.archive_cache (
  key text primary key check (key ~ '^(bill|member):[A-Za-z0-9-]+$'),
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table public.archive_cache is 'fetch-on-demand results; 30-day TTL for past Congresses, 1 hour otherwise.';

create index archive_cache_expires_idx on public.archive_cache (expires_at);

alter table public.archive_cache enable row level security;

-- Purge expired entries daily.
select cron.schedule('purge-archive-cache', '13 5 * * *', $$delete from public.archive_cache where expires_at < now()$$);
