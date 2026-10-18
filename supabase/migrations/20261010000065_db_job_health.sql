-- Database-only jobs reach the health check (review items 8 and 10; CLAUDE.md rule 6;
-- docs/decisions.md §107).
--
-- * check_database_size wrote its status row and then raised, which rolled the row
--   back: the size alarm could never fire. It now records the error and returns.
-- * Every pg_cron job that runs SQL directly (purges, the member-stats refresh, the
--   monthly trim, the size check) runs through private.run_db_job, which records its
--   start, success or error in sync_state, and is registered in private.job_schedule,
--   so private.health_rows() and the Data status page see a job that stops or fails.
--
-- No upstream requests.

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
  -- Record, don't raise: an exception here would roll this status row back.
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
  return size_bytes;
end;
$$;

-- Run one SQL job and record it in sync_state like the scheduled functions. A failure
-- is recorded (the job's own work is rolled back by the inner block) and not raised.
create or replace function private.run_db_job(p_job text, p_command text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows bigint := 0;
begin
  insert into public.sync_state (job, last_started_at, updated_at)
  values (p_job, now(), now())
  on conflict (job) do update set last_started_at = now(), updated_at = now();
  begin
    execute p_command;
    get diagnostics v_rows = row_count;
    update public.sync_state
       set last_success_at = now(), rows_written = v_rows::integer,
           last_progress_at = case when v_rows > 0 then now() else last_progress_at end,
           updated_at = now()
     where job = p_job;
  exception when others then
    update public.sync_state
       set last_error = left(sqlerrm, 500), last_error_at = now(), updated_at = now()
     where job = p_job;
  end;
end;
$$;

revoke all on function private.run_db_job(text, text) from public, anon, authenticated;

-- The same jobs and times, now recorded. cron.schedule replaces a job with the same name.
select cron.schedule('check-database-size', '41 4 * * 1', $$select private.check_database_size(400)$$);
select cron.schedule('purge-api-usage', '19 3 * * *',
  $$select private.run_db_job('purge-api-usage', $j$delete from public.api_usage where hour < now() - interval '60 days'$j$)$$);
select cron.schedule('purge-archive-cache', '13 5 * * *',
  $$select private.run_db_job('purge-archive-cache', $j$delete from public.archive_cache where expires_at < now()$j$)$$);
select cron.schedule('purge-cron-history', '7 3 * * *',
  $$select private.run_db_job('purge-cron-history', $j$delete from cron.job_run_details where end_time < now() - interval '14 days'$j$)$$);
select cron.schedule('purge-discussion-requests-anon', '41 3 * * *',
  $$select private.run_db_job('purge-discussion-requests-anon', $j$delete from public.discussion_requests_anon where created_at < now() - interval '180 days'$j$)$$);
select cron.schedule('purge-feed-events', '29 3 * * *',
  $$select private.run_db_job('purge-feed-events', $j$delete from public.feed_events where occurred_at < now() - interval '180 days'$j$)$$);
select cron.schedule('purge-geo-cache', '23 3 * * *',
  $$select private.run_db_job('purge-geo-cache', $j$delete from public.geo_cache where expires_at < now()$j$)$$);
select cron.schedule('purge-rate-limits', '37 3 * * *',
  $$select private.run_db_job('purge-rate-limits', $j$delete from private.rate_limits where window_start < now() - interval '1 day'$j$)$$);
select cron.schedule('refresh-member-stats', '3,33 * * * *',
  $$select private.run_db_job('refresh-member-stats', 'select private.refresh_member_stats()')$$);
select cron.schedule('trim-past-congresses', '17 4 5 * *',
  $$select private.run_db_job('trim-past-congresses', 'select private.trim_past_congresses()')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('db-size', 'Database size (under 400 MB)', '7 days', 'pg_cron: check-database-size'),
  ('purge-api-usage', 'Purge old API usage counts', '1 day', 'pg_cron'),
  ('purge-archive-cache', 'Purge expired on-demand cache', '1 day', 'pg_cron'),
  ('purge-cron-history', 'Purge old cron history', '1 day', 'pg_cron'),
  ('purge-discussion-requests-anon', 'Purge old anonymous discussion requests', '1 day', 'pg_cron'),
  ('purge-feed-events', 'Purge old feed events', '1 day', 'pg_cron'),
  ('purge-geo-cache', 'Purge expired address lookups', '1 day', 'pg_cron'),
  ('purge-rate-limits', 'Purge per-client limit counts', '1 day', 'pg_cron'),
  ('refresh-member-stats', 'Member vote statistics', '30 minutes', 'pg_cron'),
  ('trim-past-congresses', 'Trim past Congresses', '1 month', 'pg_cron')
on conflict (job) do nothing;
