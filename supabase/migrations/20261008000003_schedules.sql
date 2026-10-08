-- Phase 1: schedules. pg_cron triggers the sync Edge Functions through pg_net.
--
-- One-time setup per project (see README "Deploy"): store the project URL and the
-- shared sync secret in Vault. Until both exist, scheduled calls are skipped with
-- a notice, so local databases and fresh forks never call anything.
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<same value as the SYNC_SECRET function secret>', 'sync_secret');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.invoke_sync(fn text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_url text;
  secret text;
  request_id bigint;
begin
  select decrypted_secret into base_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'sync_secret';
  if base_url is null or secret is null then
    raise notice 'invoke_sync(%): Vault secrets project_url and sync_secret are not set; skipping', fn;
    return null;
  end if;
  select net.http_post(
    url := rtrim(base_url, '/') || '/functions/v1/' || fn,
    headers := jsonb_build_object('content-type', 'application/json', 'x-sync-secret', secret),
    body := body,
    timeout_milliseconds := 150000
  ) into request_id;
  return request_id;
end;
$$;

revoke all on function private.invoke_sync(text, jsonb) from public, anon, authenticated;

-- Database size guard (plan: fail loudly above 400 MB of the 500 MB free tier).
-- Records the size in sync_state and raises, which marks the cron run as failed.
create or replace function private.check_database_size(limit_mb integer default 400)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  size_bytes bigint := pg_database_size(current_database());
  over boolean := size_bytes > limit_mb::bigint * 1024 * 1024;
begin
  insert into public.sync_state (job, cursor, last_started_at, last_success_at, last_error, last_error_at, updated_at)
  values (
    'db-size',
    jsonb_build_object('bytes', size_bytes, 'mb', round(size_bytes / 1048576.0, 1), 'limit_mb', limit_mb),
    now(),
    case when over then null else now() end,
    case when over then format('Database is %s MB, above the %s MB limit', round(size_bytes / 1048576.0), limit_mb) end,
    case when over then now() end,
    now()
  )
  on conflict (job) do update set
    cursor = excluded.cursor,
    last_started_at = excluded.last_started_at,
    last_success_at = coalesce(excluded.last_success_at, public.sync_state.last_success_at),
    last_error = excluded.last_error,
    last_error_at = coalesce(excluded.last_error_at, public.sync_state.last_error_at),
    updated_at = now();
  if over then
    raise exception 'Database size % MB exceeds % MB', round(size_bytes / 1048576.0), limit_mb;
  end if;
  return size_bytes;
end;
$$;

revoke all on function private.check_database_size(integer) from public, anon, authenticated;

-- Schedules (cron.schedule is idempotent by job name). Times are UTC.
-- Bills every 10 minutes: each run is time-boxed for the Edge Function limit and
-- capped at ~580 requests, so six runs stay near 3,500 Congress.gov requests/hour.
select cron.schedule('sync-federal', '*/10 * * * *', $$select private.invoke_sync('sync-federal')$$);
select cron.schedule('sync-members', '23 6 * * *', $$select private.invoke_sync('sync-members')$$);
select cron.schedule('check-database-size', '41 4 * * 1', $$select private.check_database_size(400)$$);
-- Keep cron's own history from growing without bound.
select cron.schedule('purge-cron-history', '7 3 * * *', $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);
