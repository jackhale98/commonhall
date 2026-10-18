-- Federal spending: where the money comes from and goes, each agency's budget, and
-- what is awarded in each state and congressional district. Refreshed daily by
-- sync-federal-budget from two public sources with no key: the Monthly Treasury
-- Statement (Treasury Fiscal Data API, a new statement each month) and USAspending.gov.
-- About 1,000 rows in all (two statements of 33 lines, about 110 agencies, about 500
-- states and districts for one fiscal year); the sync removes anything older. A run
-- makes at most nine requests: three to the Treasury and six to USAspending, the
-- latter weekly.

-- The Monthly Treasury Statement's Table 9: receipts by source and outlays by budget
-- function, for the month and the fiscal year to date, with the same months of the year
-- before. The newest statement, and while a year is under way the last of the year before.
create table public.federal_mts_lines (
  /** The statement's date: the last day of its month. */
  record_date date not null,
  /** The line's place in the table. */
  line smallint not null,
  section text not null check (section in ('receipts', 'outlays')),
  /** 1 a section heading, 2 its lines, 3 a line within one. */
  level smallint not null,
  /** S a heading, D a line with amounts, T a total. */
  kind char(1) not null check (kind in ('S', 'D', 'T')),
  label text not null,
  /** The month's amount, the fiscal year's to date, and the year before's to the same month. */
  month numeric(18, 2),
  fytd numeric(18, 2),
  prior_fytd numeric(18, 2),
  updated_at timestamptz not null default now(),
  primary key (record_date, line)
);

comment on table public.federal_mts_lines is
  'Monthly Treasury Statement Table 9 (receipts by source, outlays by function): the newest statement and the last of the year before.';

-- Each top-tier agency's budget for the fiscal year under way, from USAspending.
create table public.federal_agency_budgets (
  /** USAspending's toptier code ("020" Treasury). */
  toptier_code text primary key,
  name text not null,
  abbreviation text not null default '',
  /** USAspending's page for the agency: usaspending.gov/agency/{slug}. */
  slug text not null default '',
  /** The fiscal year and quarter the amounts are reported through. */
  fiscal_year smallint not null,
  fiscal_quarter smallint not null,
  /** Total budgetary resources the agency may commit in the year. */
  budget_authority numeric(18, 2) not null default 0,
  obligated numeric(18, 2) not null default 0,
  outlays numeric(18, 2) not null default 0,
  /** Its share of all agencies' budget authority, 0 to 1. */
  share numeric not null default 0,
  /** The agency's congressional budget justification, checked with safeUrl. */
  justification_url text,
  updated_at timestamptz not null default now()
);

comment on table public.federal_agency_budgets is
  'Each federal agency''s budget authority, obligations and outlays for the fiscal year under way (USAspending).';

-- Money obligated in a fiscal year by where the work is done or the aid is used, per
-- state and per congressional district: contracts, grants, and other financial
-- assistance (direct payments, loans, insurance), from USAspending.
create table public.federal_area_spending (
  /** "MA" for a state; "MA-09" for a district ("AK-00" at large, "DC-98" a delegate's). */
  area text not null,
  fiscal_year smallint not null,
  state char(2) not null,
  /** Null for a whole state. */
  district smallint,
  contracts numeric(18, 2) not null default 0,
  grants numeric(18, 2) not null default 0,
  other numeric(18, 2) not null default 0,
  /** USAspending's population figure for the area. */
  population integer,
  updated_at timestamptz not null default now(),
  primary key (area, fiscal_year)
);

create index federal_area_spending_state on public.federal_area_spending (state, district);

comment on table public.federal_area_spending is
  'Federal contracts, grants and other assistance obligated in a fiscal year, by state and congressional district (USAspending, place of performance).';

alter table public.federal_mts_lines enable row level security;
create policy "Public read" on public.federal_mts_lines for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.federal_mts_lines from anon, authenticated;

alter table public.federal_agency_budgets enable row level security;
create policy "Public read" on public.federal_agency_budgets for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.federal_agency_budgets from anon, authenticated;

alter table public.federal_area_spending enable row level security;
create policy "Public read" on public.federal_area_spending for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.federal_area_spending from anon, authenticated;

-- Daily at 08:53 UTC, before the nightly site rebuild (09:17). The Treasury publishes
-- each statement in the afternoon (Eastern) of about the eighth working day of a month.
select cron.schedule('sync-federal-budget', '53 8 * * *', $$select private.invoke_sync('sync-federal-budget')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('federal-budget', 'Federal spending (Treasury, USAspending)', '1 day', 'sync-federal-budget')
on conflict (job) do nothing;
