-- State high court decisions (CourtListener) and governors' executive orders.
--
-- state_court_cases: one row per decided case, kept current by sync-state-courts
-- (every three hours; CourtListener's free tier is shared with sync-scotus).
-- state_executive_orders: loaded weekly by the "Load governor orders" workflow,
-- which reads the state's list in a browser (mass.gov refuses plain requests).

create table public.state_court_cases (
  cluster_id bigint primary key,
  /** CourtListener court id: mass (Supreme Judicial Court), … */
  court_id text not null,
  state char(2) not null,
  case_name text not null,
  case_name_full text,
  docket_number text,
  date_filed date not null,
  date_argued date,
  citations text[] not null default '{}',
  url text not null,
  judges text,
  opinion_types text[] not null default '{}',
  dissents smallint not null default 0,
  concurrences smallint not null default 0,
  per_curiam boolean not null default false,
  summary text,
  created_at timestamptz not null default now()
);

comment on table public.state_court_cases is 'State high court decisions from CourtListener.';
create index state_court_cases_state_date_idx on public.state_court_cases (state, date_filed desc);

alter table public.state_court_cases enable row level security;
create policy "Public read" on public.state_court_cases for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_court_cases from anon, authenticated;

create table public.state_executive_orders (
  state char(2) not null,
  number integer not null,
  title text not null,
  signed_date date,
  governor text,
  /** Earlier orders this one revokes or supersedes, as printed ("Executive Order No. 368"). */
  revokes text,
  url text not null,
  created_at timestamptz not null default now(),
  primary key (state, number)
);

comment on table public.state_executive_orders is 'Governors'' executive orders, from each state''s published list.';
create index state_executive_orders_date_idx on public.state_executive_orders (state, signed_date desc nulls last);

alter table public.state_executive_orders enable row level security;
create policy "Public read" on public.state_executive_orders for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_executive_orders from anon, authenticated;

select cron.schedule('sync-state-courts', '50 */3 * * *', $$select private.invoke_sync('sync-state-courts')$$);
