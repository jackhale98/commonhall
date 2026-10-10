-- How many bills Open States lists for each state's current session (recorded by
-- sync-state from its pagination, about weekly), and how many we hold: the
-- coverage line on the state pages.

create table public.state_bill_counts (
  state char(2) primary key,
  session text not null,
  reported_total integer not null,
  checked_at timestamptz not null default now()
);

comment on table public.state_bill_counts is 'Open States'' count of bills in each state''s current session.';

alter table public.state_bill_counts enable row level security;
create policy "Public read" on public.state_bill_counts for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_bill_counts from anon, authenticated;

create or replace view public.state_bill_coverage
with (security_invoker = true)
as
select c.state, c.session, c.reported_total, c.checked_at,
       (select count(*)::integer from public.state_bills b where b.state = c.state and b.session = c.session) as loaded
  from public.state_bill_counts c;

grant select on public.state_bill_coverage to anon, authenticated;
