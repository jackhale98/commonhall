-- Job health: know when a source stops arriving.
--
-- Until now a failed or starved job looked fine: functions answered 200, pg_cron logs
-- only that it queued the request, and a run that wrote nothing (out of budget, a
-- renamed field) counted as a success. Two checks replace guesswork:
--
--   * jobs: each scheduled job and loader is registered with how often it runs;
--     it is flagged when its last run failed, it is overdue, or a run died without
--     recording an end.
--   * data: the newest record of each dataset (per city and per court, so a new
--     one is covered without editing this) is compared with how often it changes.
--
-- private.sync_health() lists the problems (the daily "Sync health" workflow fails
-- on any, so GitHub emails the owner); public.data_status() is the same list without
-- error text, for the site's Data status page.

alter table public.sync_state add column if not exists last_progress_at timestamptz;
comment on column public.sync_state.last_progress_at is 'The last successful run that wrote at least one row.';

create table private.job_schedule (
  job text primary key,
  label text not null,
  -- How often it runs; a job is overdue after twice this plus an hour.
  every interval not null,
  -- Where it runs, for whoever fixes it.
  runner text not null,
  created_at timestamptz not null default now()
);

comment on table private.job_schedule is 'Every scheduled job and loader, how often it runs, for private.sync_health().';

insert into private.job_schedule (job, label, every, runner) values
  ('federal-votes', 'House and Senate roll calls', '10 minutes', 'sync-federal'),
  ('federal-bills', 'Bills in Congress', '10 minutes', 'sync-federal'),
  ('federal-members', 'Members of Congress', '1 day', 'sync-members'),
  ('committees', 'Congressional committees', '1 hour', 'sync-committees'),
  ('finance', 'Campaign finance', '1 hour', 'sync-finance'),
  ('executive', 'Executive orders and nominations', '1 hour', 'sync-executive'),
  ('scotus', 'Supreme Court decisions', '1 hour', 'sync-scotus'),
  ('state', 'State bills', '1 hour', 'sync-state'),
  ('state-courts', 'State high court decisions', '3 hours', 'sync-state-courts'),
  ('boston', 'Boston City Council', '15 minutes', 'sync-boston'),
  ('boston-311', 'Boston 311 requests', '1 day', 'sync-boston-311'),
  ('boston-zba', 'Boston zoning appeals', '1 day', 'sync-boston-zba'),
  ('capital-plan', 'Boston capital plan', '7 days', 'sync-capital-plan'),
  ('city-budget', 'Boston operating budget', '7 days', 'sync-city-budget'),
  ('worcester', 'Worcester City Council meetings', '1 hour', 'sync-worcester'),
  ('load-worcester-agendas', 'Worcester council agenda items', '1 day', 'workflow: Load Worcester agendas'),
  ('load-worcester-budget', 'Worcester budget', '1 month', 'workflow: Load Worcester budget'),
  ('load-ma-orders', 'Massachusetts governor''s orders', '7 days', 'workflow: Load governor orders'),
  ('load-scdb', 'Supreme Court Database', '1 month', 'workflow: Load SCDB'),
  ('load-state-people', 'State legislators', '7 days', 'workflow: Load state people')
on conflict (job) do nothing;

-- Datasets whose newest record says whether new data is arriving, and how old it may
-- get before that is suspicious (generous: recesses and quiet weeks are normal).
create or replace function private.data_freshness()
returns table (name text, label text, newest date, max_age interval)
language sql
stable
security definer
set search_path = ''
as $$
  select 'bills', 'Bills in Congress', max(update_date)::date, interval '7 days' from public.bills
  union all
  select 'state-bills', 'State bills', max(updated_at)::date, interval '7 days' from public.state_bills
  union all
  select 'executive-orders', 'Presidential documents', max(publication_date), interval '90 days'
    from public.executive_orders
  union all
  select 'scotus', 'Supreme Court decisions', max(date_filed), interval '150 days' from public.scotus_cases
  union all
  select 'court:' || court_id, 'Decisions: ' || court_id, max(date_filed), interval '45 days'
    from public.state_court_cases group by court_id
  union all
  select 'governor:' || state, 'Governor''s orders: ' || state, max(signed_date), interval '180 days'
    from public.state_executive_orders group by state
  union all
  select 'matters:' || city, 'Council items: ' || city, max(coalesce(agenda_date, intro_date)), interval '45 days'
    from public.local_matters group by city
  union all
  select 'meetings:' || city, 'Council meetings: ' || city, max(date), interval '45 days'
    from public.local_meetings where date <= current_date group by city
  union all
  select '311', 'Boston 311 requests', max(day), interval '4 days' from public.boston_311_daily
  union all
  select 'zba', 'Boston zoning appeals', max(received_date), interval '30 days' from public.zba_appeals;
$$;

create or replace function private.health_rows()
returns table (
  kind text,
  name text,
  label text,
  runner text,
  last_ok timestamptz,
  newest date,
  problem text,
  error text
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'job', j.job, j.label, j.runner, s.last_success_at, null::date,
    case
      when s.job is null and j.created_at < now() - (2 * j.every + interval '1 hour') then 'has never run'
      when s.job is null then null
      when s.last_error_at is not null and s.last_error_at >= coalesce(s.last_success_at, '-infinity')
        then 'last run failed'
      when s.last_started_at > greatest(coalesce(s.last_success_at, '-infinity'), coalesce(s.last_error_at, '-infinity'))
           and s.last_started_at < now() - interval '1 hour'
        then 'last run stopped without finishing'
      when s.last_success_at is null and j.created_at < now() - (2 * j.every + interval '1 hour')
        then 'has never succeeded'
      when s.last_success_at < now() - (2 * j.every + interval '1 hour') then 'overdue'
    end,
    s.last_error
  from private.job_schedule j
  left join public.sync_state s on s.job = j.job
  union all
  select 'data', f.name, f.label, null, null, f.newest,
    case
      when f.newest is null then 'empty'
      when f.newest < current_date - f.max_age then 'nothing new since ' || f.newest::text
    end,
    null
  from private.data_freshness() f;
$$;

-- The problems only (with error text). Service role only.
create or replace function private.sync_health()
returns table (kind text, name text, label text, runner text, problem text, last_ok timestamptz, newest date, error text)
language sql
stable
security definer
set search_path = ''
as $$
  select kind, name, label, runner, problem, last_ok, newest, left(error, 300)
    from private.health_rows() where problem is not null order by kind, name;
$$;

-- Everything, without error text or runners, for the public Data status page.
create or replace function public.data_status()
returns table (kind text, name text, label text, last_ok timestamptz, newest date, problem text)
language sql
stable
security definer
set search_path = ''
as $$
  select kind, name, label, last_ok, newest, problem from private.health_rows() order by kind, label;
$$;

revoke all on function private.data_freshness() from public, anon, authenticated;
revoke all on function private.health_rows() from public, anon, authenticated;
revoke all on function private.sync_health() from public, anon, authenticated;
revoke all on function public.data_status() from public;
grant execute on function public.data_status() to anon, authenticated;
