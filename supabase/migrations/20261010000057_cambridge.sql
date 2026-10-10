-- Cambridge, MA: the City Council (IQM2 archive and PrimeGov), and 311, budget and
-- capital plan from the city's open data portal (data.cambridgema.gov).
--
-- The tables Boston's open data filled first are keyed by city now, so a second
-- city's capital projects, budget lines or zoning cases can't collide with Boston's
-- (both cities number capital projects their own way). Written to be safe if
-- another migration already did this.

do $$
declare
  t record;
  pk text;
begin
  for t in
    select * from (values
      ('capital_projects', 'city, proj_id'),
      ('city_budget_lines', 'city, kind, cabinet, dept, grouping, line, fiscal_year, basis'),
      ('zba_appeals', 'city, boa_apno'),
      ('zba_decision_counts', 'city, neighborhood, decision')
    ) as x(tbl, cols)
  loop
    select conname into pk from pg_constraint
     where conrelid = format('public.%I', t.tbl)::regclass and contype = 'p';
    if pk is null or not exists (
      select 1 from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
       where c.conname = pk and c.conrelid = format('public.%I', t.tbl)::regclass and a.attname = 'city'
    ) then
      if pk is not null then
        execute format('alter table public.%I drop constraint %I', t.tbl, pk);
      end if;
      execute format('alter table public.%I add primary key (%s)', t.tbl, t.cols);
    end if;
  end loop;
end $$;

comment on table public.capital_projects is
  'Capital plan projects per city (Boston: Analyze Boston; Cambridge: data.cambridgema.gov), refreshed by each city''s sync.';
comment on table public.city_budget_lines is
  'Operating and revenue budget lines per city and fiscal year; missing amounts are left out.';

-- Council: every 30 minutes (current meetings are two list requests; the IQM2
-- archive loads once, a little each run). Open data: daily, after the city's
-- nightly refresh.
select cron.schedule('sync-cambridge', '7,37 * * * *', $$select private.invoke_sync('sync-cambridge')$$);
select cron.schedule('sync-cambridge-data', '41 10 * * *', $$select private.invoke_sync('sync-cambridge-data')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('cambridge', 'Cambridge City Council', '30 minutes', 'sync-cambridge'),
  ('cambridge-data', 'Cambridge 311, budget and capital plan', '1 day', 'sync-cambridge-data')
on conflict (job) do nothing;
