-- 311: store each city's report, not daily counts.
--
-- The site only ever showed two 30-day windows (the last 30 days and the 30 before,
-- per district: counts, typical time to close, top request types). We kept 120 days
-- of counts per day, district and type (about 23,500 rows, ~5 MB for Boston alone,
-- and ~60,000 a year for a city like Somerville). The sync now reads the 62 days it
-- needs from the city each morning (about 2 seconds) and stores only the finished
-- report: one row per city, a few kilobytes. No individual request was ever stored,
-- and none is now.

create table public.city_311_reports (
  city text primary key,
  report jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.city_311_reports is
  '311 per city: the last 30 days and the 30 before, citywide and per district (report-311.ts). Rebuilt daily.';

alter table public.city_311_reports enable row level security;
create policy "Public read" on public.city_311_reports for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.city_311_reports from anon, authenticated;
grant select on public.city_311_reports to anon, authenticated;

-- Freshness: each city's report, by the last day it covers.
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
  select '311:' || city, '311 requests: ' || city, (report->>'to')::date, interval '4 days'
    from public.city_311_reports
  union all
  select 'zba', 'Boston zoning appeals', max(received_date), interval '30 days' from public.zba_appeals;
$$;

revoke all on function private.data_freshness() from public, anon, authenticated;

drop table public.boston_311_daily;
