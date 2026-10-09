-- Campaign finance from the FEC: one summary row per member of Congress, refreshed
-- in rotation (about weekly) by sync-finance. Aggregates only; never individual
-- donors' names.

alter table public.members add column fec_candidate_id text;
alter table public.members add column next_election smallint;
comment on column public.members.fec_candidate_id is 'FEC candidate id for the current office (from congress-legislators id.fec).';
comment on column public.members.next_election is 'Year of the next general election for this seat (last year of the current term).';

create table public.member_finance (
  member_id text primary key references public.members (bioguide_id) on delete cascade,
  candidate_id text not null,
  committee_id text,
  committee_name text,
  election_year smallint not null,
  /** Two-year period used for employers and PACs (e.g. 2026). */
  period smallint not null,
  coverage_start date,
  coverage_end date,
  last_report text,
  receipts numeric(14, 2),
  disbursements numeric(14, 2),
  cash_on_hand numeric(14, 2),
  debts numeric(14, 2),
  individual_small numeric(14, 2),
  individual_large numeric(14, 2),
  pacs numeric(14, 2),
  party numeric(14, 2),
  self_funding numeric(14, 2),
  transfers numeric(14, 2),
  /** [{size, total, count}] with size the bucket's lower bound: 0, 200, 500, 1000, 2000. */
  by_size jsonb not null default '[]'::jsonb,
  in_state numeric(14, 2),
  out_of_state numeric(14, 2),
  /** Top states by itemized individual contributions: [{state, total}]. */
  top_states jsonb not null default '[]'::jsonb,
  /** Top donor employers (individuals' contributions grouped by employer): [{name, total, count}]. */
  top_employers jsonb not null default '[]'::jsonb,
  /** Largest PAC contributors (Form 3 line 11C): [{name, id, total, type}]. */
  top_committees jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.member_finance is 'FEC campaign finance summary per member (aggregates only).';
create index member_finance_fetched_idx on public.member_finance (fetched_at);

alter table public.member_finance enable row level security;
create policy "Public read" on public.member_finance for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.member_finance from anon, authenticated;

-- Hourly, a few minutes per run, within an hourly FEC request budget.
select cron.schedule('sync-finance', '35 * * * *', $$select private.invoke_sync('sync-finance')$$);
