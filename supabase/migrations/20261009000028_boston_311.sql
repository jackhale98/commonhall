-- Boston 311 summaries (Analyze Boston, "311-service-requests"), refreshed daily by
-- sync-boston-311. Only counts are stored, never individual requests or addresses:
-- one row per day (Boston time), council district, request type and source system.
-- The city runs two 311 systems side by side ("new": Public Works, Parks and most
-- departments; "legacy": Transportation and Inspectional Services), and they hold
-- different cases, so the site adds them together. `closed` and `closed_on_time`
-- count requests opened that day that have since been closed (re-read for two weeks).

create table public.boston_311_daily (
  day date not null,
  /** City Council district 1–9; 0 when the city did not give one. */
  district smallint not null,
  request_type text not null,
  source text not null check (source in ('new', 'legacy')),
  opened integer not null,
  closed integer not null,
  closed_on_time integer not null,
  /** Median hours from opening to closing, for the closed ones. */
  median_close_hours numeric(10, 2),
  updated_at timestamptz not null default now(),
  primary key (day, district, request_type, source)
);

comment on table public.boston_311_daily is 'Boston 311 requests per day, district and type (counts only; kept 120 days).';
create index boston_311_daily_district_idx on public.boston_311_daily (district, day);

alter table public.boston_311_daily enable row level security;
create policy "Public read" on public.boston_311_daily for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.boston_311_daily from anon, authenticated;

-- Daily, 10:11 UTC (about 6 a.m. in Boston), after the city's overnight refresh.
select cron.schedule('sync-boston-311', '11 10 * * *', $$select private.invoke_sync('sync-boston-311')$$);
