-- The City of Boston's five-year Capital Plan (Analyze Boston, "capital-budget"),
-- one row per project, refreshed weekly by sync-capital-plan. Money in dollars.
-- Year 1 is the plan's first fiscal year; year 0 the one before it; "years 2-5"
-- the rest of the plan (City of Boston data dictionary).

create table public.capital_projects (
  proj_id text primary key,
  /** e.g. FY27-31 */
  plan text not null,
  /** Fiscal year of the plan's year 1, e.g. 2027. */
  first_year smallint,
  department text,
  name text not null,
  scope text,
  status text,
  neighborhood text,
  pm_department text,
  total_budget numeric not null default 0,
  /** Spent before year 0 (bond, other city and grant funds). */
  spent numeric not null default 0,
  /** Planned spending in year 0, year 1 and years 2-5. */
  year0 numeric not null default 0,
  year1 numeric not null default 0,
  years_2_5 numeric not null default 0,
  external_funds numeric not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.capital_projects is 'Boston Capital Plan projects (Analyze Boston), refreshed weekly.';
create index capital_projects_department_idx on public.capital_projects (department);

alter table public.capital_projects enable row level security;
create policy "Public read" on public.capital_projects for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.capital_projects from anon, authenticated;

-- Weekly, Mondays 06:41 UTC; the plan changes once a year.
select cron.schedule('sync-capital-plan', '41 6 * * 1', $$select private.invoke_sync('sync-capital-plan')$$);
