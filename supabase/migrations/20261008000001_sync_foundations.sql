-- Phase 0: bookkeeping for scheduled jobs.
--
-- These tables are written only by the service role (which bypasses RLS). RLS is
-- enabled with no policies, so the anon and authenticated roles cannot read them.

-- One row per job: cursor, last success/error and requests used by the last run.
create table public.sync_state (
  job text primary key,
  cursor jsonb not null default '{}'::jsonb,
  last_started_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  requests_used integer not null default 0,
  rows_written integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.sync_state is 'Cursor and health of each scheduled job.';

-- A lease per job. Jobs take the lease with try_sync_lock() and release it with
-- release_sync_lock(); a crashed run's lease expires on its own, so a rerun is safe.
-- (A lease is used rather than pg_advisory_lock because Edge Functions may reach
-- Postgres through a transaction-mode pooler, where session locks are unreliable.)
create table public.sync_lock (
  job text primary key,
  holder text,
  locked_at timestamptz,
  expires_at timestamptz
);

comment on table public.sync_lock is 'Leases that stop two runs of the same job overlapping.';

-- Requests made to each upstream API per clock hour, shared by every job so the
-- backfill and the hourly sync cannot jointly exceed an upstream rate limit.
create table public.api_usage (
  api text not null,
  hour timestamptz not null,
  requests integer not null default 0,
  primary key (api, hour)
);

comment on table public.api_usage is 'Upstream requests per API per hour (UTC).';

alter table public.sync_state enable row level security;
alter table public.sync_lock enable row level security;
alter table public.api_usage enable row level security;

create or replace function public.try_sync_lock(p_job text, p_holder text, p_ttl interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  acquired boolean;
begin
  insert into public.sync_lock (job) values (p_job) on conflict (job) do nothing;
  update public.sync_lock
     set holder = p_holder, locked_at = now(), expires_at = now() + p_ttl
   where job = p_job
     and (holder is null or expires_at is null or expires_at < now() or holder = p_holder)
  returning true into acquired;
  return coalesce(acquired, false);
end;
$$;

create or replace function public.release_sync_lock(p_job text, p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sync_lock
     set holder = null, locked_at = null, expires_at = null
   where job = p_job and holder = p_holder;
$$;

-- Add `p_requests` to the current hour's counter and return the new total.
create or replace function public.record_api_usage(p_api text, p_requests integer)
returns integer
language sql
security definer
set search_path = ''
as $$
  insert into public.api_usage (api, hour, requests)
  values (p_api, date_trunc('hour', now()), p_requests)
  on conflict (api, hour) do update set requests = public.api_usage.requests + excluded.requests
  returning requests;
$$;

create or replace function public.api_usage_this_hour(p_api text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select requests from public.api_usage where api = p_api and hour = date_trunc('hour', now())), 0);
$$;

-- Only the service role may call the job helpers.
revoke all on function public.try_sync_lock(text, text, interval) from public, anon, authenticated;
revoke all on function public.release_sync_lock(text, text) from public, anon, authenticated;
revoke all on function public.record_api_usage(text, integer) from public, anon, authenticated;
revoke all on function public.api_usage_this_hour(text) from public, anon, authenticated;
grant execute on function public.try_sync_lock(text, text, interval) to service_role;
grant execute on function public.release_sync_lock(text, text) to service_role;
grant execute on function public.record_api_usage(text, integer) to service_role;
grant execute on function public.api_usage_this_hour(text) to service_role;
