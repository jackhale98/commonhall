-- How much of each source we hold, so a page can say when whole records are still
-- loading ("Still loading: 9,500 of 19,700 bills so far") instead of looking complete
-- (docs/decisions.md §126). Only record counts: details still being added to records
-- we already hold (committee referrals, clause references) are not reported.
--
-- source_totals holds an upstream total for sources that publish one. sync-federal
-- records Congress.gov's bill count for the current Congress once a day (one request
-- from the existing Congress.gov budget). State bills keep their own counts
-- (state_bill_counts, migration 044). No rows rewritten.

create table public.source_totals (
  /** "bills:119". */
  source text primary key,
  /** How many records the source says it has. */
  expected integer not null check (expected >= 0),
  counted_at timestamptz not null default now()
);

comment on table public.source_totals is
  'Upstream record counts (Congress.gov bills per Congress), compared with what we hold by public.data_coverage().';

alter table public.source_totals enable row level security;
create policy "Public read" on public.source_totals for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.source_totals from anon, authenticated;

-- Each counted source: what we hold against the upstream total, and when the total was
-- counted. Federal bills by Congress; state bills by state for the session counted.
create or replace function public.data_coverage()
returns table (source text, held integer, expected integer, counted_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select t.source,
         (select count(*)::integer from public.bills b where b.congress = split_part(t.source, ':', 2)::smallint),
         t.expected, t.counted_at
    from public.source_totals t
   where t.source like 'bills:%'
  union all
  select * from (
    select distinct on (c.state) 'state-bills:' || c.state, c.loaded, c.reported_total, c.checked_at
      from public.state_bill_coverage c
     order by c.state, c.checked_at desc
  ) s;
$$;

revoke all on function public.data_coverage() from public;
grant execute on function public.data_coverage() to anon, authenticated;
