-- Connecticut budgets, read by sync-state-budget alongside Massachusetts' (no new
-- schedule, no rows rewritten). Two data.ct.gov datasets, no key, each read only when
-- it has changed (at most four requests a day):
--
-- - The state's budget and spending, program by program, from the Office of the State
--   Comptroller's expense data (43fc-9893), for the funds the General Assembly
--   appropriates: the General Fund, the Special Transportation Fund and the smaller
--   budgeted funds. About 700 lines a year, three years kept, into state_budget_lines,
--   which gains a fund column (Massachusetts' lines leave it empty).
-- - Each town's adopted budget, from the Office of Policy and Management's summary of
--   municipal budgets (pcg4-s5rc): revenue by source, education, debt service, total
--   spending and mill rates for all 169 towns and the City of Groton. About 170 rows a
--   year; six years kept.

alter table public.state_budget_lines add column fund text not null default '';

comment on column public.state_budget_lines.fund is
  'The fund the line is paid from ("General Fund", "Transportation"); empty where the source has no funds (Massachusetts).';

-- The accounts view gains the fund (Connecticut's lines are one account each).
create or replace view public.state_budget_accounts
with (security_invoker = true)
as
select state, fiscal_year, account,
       max(account_name) as account_name,
       (array_agg(department order by total_enacted desc, spent desc, department))[1] as department,
       (array_agg(cabinet order by total_enacted desc, spent desc, cabinet))[1] as cabinet,
       max(category) as category,
       sum(enacted) as enacted,
       sum(supplemental) as supplemental,
       sum(total_enacted) as total_enacted,
       sum(available) as available,
       sum(spent) as spent,
       max(fund) as fund
  from public.state_budget_lines
 group by state, fiscal_year, account;

create table public.town_budgets (
  state char(2) not null,
  /** The town as the source names it ("BRISTOL", "GROTON (CITY)"). */
  town text not null,
  /** Fiscal year, e.g. 2026 for July 2025 – June 2026. */
  fiscal_year smallint not null,
  property_tax numeric(16, 2) not null default 0,
  state_revenue numeric(16, 2) not null default 0,
  federal_revenue numeric(16, 2) not null default 0,
  /** Reserves the budget draws on. */
  fund_balance numeric(16, 2) not null default 0,
  other_revenue numeric(16, 2) not null default 0,
  total_revenue numeric(16, 2) not null default 0,
  education numeric(16, 2) not null default 0,
  debt_service numeric(16, 2) not null default 0,
  contingency numeric(16, 2) not null default 0,
  other_spending numeric(16, 2) not null default 0,
  total_spending numeric(16, 2) not null default 0,
  /** Mills (dollars of tax per $1,000 of assessed value). */
  mill_rate numeric(8, 2),
  mill_rate_vehicles numeric(8, 2),
  /** The share of the levy the budget expects to collect, 0 to 1. */
  tax_collection_rate numeric(6, 4),
  adopted_on date,
  updated_at timestamptz not null default now(),
  primary key (state, town, fiscal_year)
);

comment on table public.town_budgets is
  'Each town''s adopted budget in summary: revenue by source, education, debt service, total spending and mill rates (Connecticut: OPM, data.ct.gov pcg4-s5rc).';

alter table public.town_budgets enable row level security;
create policy "Public read" on public.town_budgets for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.town_budgets from anon, authenticated;

update private.job_schedule set label = 'State budgets (Massachusetts, Connecticut) and Connecticut town budgets'
 where job = 'state-budget';
