-- State budgets: what the legislature enacted, line by line, and how much has been
-- spent. Massachusetts from the Comptroller's CTHRU portal (cthru.data.socrata.com,
-- kv7m-35wn), refreshed daily by sync-state-budget, which reads the dataset only when it
-- has changed. One row per account and department: an account's enacted amount sits
-- with the department it was appropriated to and its spending with the department that
-- spends it, as the Comptroller reports them. Three fiscal years are kept (about 7,000
-- Massachusetts rows, under 2 MB); older years are removed by the sync.

create table public.state_budget_lines (
  state char(2) not null,
  /** Fiscal year, e.g. 2027 for FY27 (in Massachusetts, July 2026 – June 2027). */
  fiscal_year smallint not null,
  /** The appropriation account number ("70610008"). */
  account text not null,
  /** The department this part of the account is recorded under. */
  department text not null default '',
  account_name text not null default '',
  /** The secretariat (Massachusetts' cabinet) the account sits under. */
  cabinet text not null default '',
  /** The Comptroller's appropriation class (Medicaid, Direct Local Aid, Debt Service, …). */
  category text not null default '',
  /** Original enacted budget (the GAA). */
  enacted numeric(16, 2) not null default 0,
  /** Supplemental budget appropriations. */
  supplemental numeric(16, 2) not null default 0,
  /** Total enacted budget appropriation: the GAA and supplemental budgets. */
  total_enacted numeric(16, 2) not null default 0,
  /** Total available for spending: total enacted, retained revenue and other authorizations, less 9C cuts. */
  available numeric(16, 2) not null default 0,
  /** Total expenses: spent so far in the current year, all year in a closed one. */
  spent numeric(16, 2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (state, fiscal_year, account, department)
);

comment on table public.state_budget_lines is
  'State budget appropriation accounts by fiscal year and department, with enacted, available and spent amounts (Massachusetts: CTHRU).';

-- One row per state: the newest fiscal year and when the source last changed, for the
-- page's "spending through" date.
create table public.state_budgets (
  state char(2) primary key,
  newest_year smallint not null,
  source_updated_at timestamptz,
  checked_at timestamptz not null default now()
);

comment on table public.state_budgets is 'Each state budget we hold: the newest fiscal year and when its source last changed.';

alter table public.state_budget_lines enable row level security;
create policy "Public read" on public.state_budget_lines for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_budget_lines from anon, authenticated;

alter table public.state_budgets enable row level security;
create policy "Public read" on public.state_budgets for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_budgets from anon, authenticated;

-- Totals by secretariat and category per year, for the Budget tab's charts (a few
-- hundred rows instead of every account).
create view public.state_budget_totals
with (security_invoker = true)
as
select state, fiscal_year, cabinet, category,
       count(*)::integer as accounts,
       sum(enacted) as enacted,
       sum(supplemental) as supplemental,
       sum(total_enacted) as total_enacted,
       sum(available) as available,
       sum(spent) as spent
  from public.state_budget_lines
 group by state, fiscal_year, cabinet, category;

grant select on public.state_budget_totals to anon, authenticated;

-- Each account added back together across departments, under the department and
-- secretariat with the most enacted (then spent), for the Budget tab's line items.
create view public.state_budget_accounts
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
       sum(spent) as spent
  from public.state_budget_lines
 group by state, fiscal_year, account;

grant select on public.state_budget_accounts to anon, authenticated;

-- Daily at 08:47 UTC, before the nightly site rebuild (09:17), so the rebuild shows the
-- Comptroller's latest refresh (the previous morning's, about 10:10 UTC).
select cron.schedule('sync-state-budget', '47 8 * * *', $$select private.invoke_sync('sync-state-budget')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('state-budget', 'State budgets (Massachusetts)', '1 day', 'sync-state-budget')
on conflict (job) do nothing;
