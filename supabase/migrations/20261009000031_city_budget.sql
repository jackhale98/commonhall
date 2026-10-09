-- Boston's operating budget (what the city spends to run departments) and revenue
-- budget (where the money comes from), from Analyze Boston ("operating-budget",
-- "revenue-budget"). One row per budget line and year: the city's files carry two
-- years of actuals, the current appropriation and the new budget, with the years in
-- the column names ("FY27 Budget"). Refreshed weekly by sync-city-budget; the files
-- change once a year.

create table public.city_budget_lines (
  /** expense (operating budget) or revenue. */
  kind text not null check (kind in ('expense', 'revenue')),
  cabinet text not null default '',
  dept text not null default '',
  /** Expense: program. Revenue: revenue category (Property Tax, State Aid, …). */
  grouping text not null default '',
  /** Expense: expense category (Personnel Services, …). Revenue: account. */
  line text not null default '',
  /** Fiscal year, e.g. 2027 for FY27 (July 2026 – June 2027). */
  fiscal_year smallint not null,
  /** actual, appropriation (current year as amended) or budget (adopted). */
  basis text not null check (basis in ('actual', 'appropriation', 'budget')),
  amount numeric(16, 2) not null,
  updated_at timestamptz not null default now(),
  primary key (kind, cabinet, dept, grouping, line, fiscal_year, basis)
);

comment on table public.city_budget_lines is
  'Boston operating and revenue budget lines by fiscal year (Analyze Boston); missing amounts are left out.';
create index city_budget_lines_year_idx on public.city_budget_lines (kind, fiscal_year);

alter table public.city_budget_lines enable row level security;
create policy "Public read" on public.city_budget_lines for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.city_budget_lines from anon, authenticated;

-- Weekly, Mondays 06:47 UTC, after the Capital Plan.
select cron.schedule('sync-city-budget', '47 6 * * 1', $$select private.invoke_sync('sync-city-budget')$$);
