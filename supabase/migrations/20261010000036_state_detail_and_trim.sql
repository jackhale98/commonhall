-- Massachusetts in full, everyone else slim, and room to grow (decision 77):
-- 1. Topics on every state bill; for Massachusetts also the summary, the full action
--    history and roll-call votes (the state sync already makes these requests; the
--    extra detail comes in the same responses).
-- 2. Co-sponsors are kept for Massachusetts only.
-- 3. State sessions (dates) and statewide officials (governor and others, from the
--    weekly openstates/people load).
-- 4. Past Congresses keep their bills and vote totals but drop action histories,
--    co-sponsors and member-by-member positions, so the federal tables don't double
--    with each new Congress.

-- 1. Bill detail
alter table public.state_bills
  add column if not exists subjects text[] not null default '{}',
  add column if not exists abstract text;

create table public.state_bill_actions (
  bill_id text not null references public.state_bills (id) on delete cascade,
  seq smallint not null,
  action_date date,
  description text not null,
  chamber text,
  classification text[] not null default '{}',
  primary key (bill_id, seq)
);

create table public.state_votes (
  id text primary key check (id like 'ocd-vote/%'),
  bill_id text not null references public.state_bills (id) on delete cascade,
  state char(2) not null,
  vote_date date,
  motion text,
  result text,
  chamber text,
  yes integer not null default 0,
  no integer not null default 0,
  other integer not null default 0
);

create index state_votes_bill_idx on public.state_votes (bill_id);
create index state_votes_state_date_idx on public.state_votes (state, vote_date desc);

create table public.state_vote_positions (
  vote_id text not null references public.state_votes (id) on delete cascade,
  seq smallint not null,
  person_id text,
  name text not null,
  option text not null,
  primary key (vote_id, seq)
);

create index state_vote_positions_person_idx on public.state_vote_positions (person_id)
  where person_id is not null;

-- 2. Co-sponsors: Massachusetts only from now on.
delete from public.state_bill_sponsors s
 using public.state_bills b
 where b.id = s.bill_id and b.state <> 'MA';

-- Read Massachusetts' bills once more so they get histories, votes and summaries.
update public.sync_state set cursor = cursor #- '{bills,MA}' where job = 'state';

-- 3. Sessions and statewide officials
create table public.state_sessions (
  state char(2) not null,
  identifier text not null,
  name text,
  classification text,
  start_date date,
  end_date date,
  primary key (state, identifier)
);

create table public.state_executives (
  id text primary key check (id like 'ocd-person/%'),
  state char(2) not null,
  name text not null,
  party text,
  role text not null,
  photo_url text,
  email text,
  offices jsonb not null default '[]'::jsonb,
  links jsonb not null default '[]'::jsonb,
  start_date date,
  synced_at timestamptz not null default now()
);

create index state_executives_state_idx on public.state_executives (state);

-- Party unity in state legislatures (Massachusetts, where votes are kept): on roll calls
-- where most Democrats and most Republicans voted on opposite sides, how often each
-- legislator voted with their own party's majority. Same method as member_party_unity.
create view public.state_party_unity with (security_invoker = true) as
with pos as (
  select p.vote_id, p.person_id, l.party, p.option
    from public.state_vote_positions p
    join public.state_legislators l on l.id = p.person_id
   where p.option in ('yes', 'no') and l.party in ('Democratic', 'Republican')
),
majorities as (
  select vote_id,
         case when sum((party = 'Democratic' and option = 'yes')::int) > sum((party = 'Democratic' and option = 'no')::int) then 'yes'
              when sum((party = 'Democratic' and option = 'yes')::int) < sum((party = 'Democratic' and option = 'no')::int) then 'no' end as d,
         case when sum((party = 'Republican' and option = 'yes')::int) > sum((party = 'Republican' and option = 'no')::int) then 'yes'
              when sum((party = 'Republican' and option = 'yes')::int) < sum((party = 'Republican' and option = 'no')::int) then 'no' end as r
    from pos
   group by vote_id
),
party_line as (
  select vote_id, d, r from majorities where d is not null and r is not null and d <> r
)
select pos.person_id,
       pos.party,
       count(*)::integer as party_votes,
       sum((pos.option = case pos.party when 'Democratic' then pl.d else pl.r end)::int)::integer as with_party
  from pos
  join party_line pl on pl.vote_id = pos.vote_id
 group by pos.person_id, pos.party;

alter table public.state_bill_actions enable row level security;
alter table public.state_votes enable row level security;
alter table public.state_vote_positions enable row level security;
alter table public.state_sessions enable row level security;
alter table public.state_executives enable row level security;
create policy "Public read" on public.state_bill_actions for select to anon, authenticated using (true);
create policy "Public read" on public.state_votes for select to anon, authenticated using (true);
create policy "Public read" on public.state_vote_positions for select to anon, authenticated using (true);
create policy "Public read" on public.state_sessions for select to anon, authenticated using (true);
create policy "Public read" on public.state_executives for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.state_bill_actions, public.state_votes,
  public.state_vote_positions, public.state_sessions, public.state_executives from anon, authenticated;
grant select on public.state_bill_actions, public.state_votes, public.state_vote_positions,
  public.state_sessions, public.state_executives, public.state_party_unity to anon, authenticated;

-- 4. Past Congresses: keep bills, votes and their totals; drop the bulky detail.
-- A Congress begins on 3 January of an odd year (the 119th: 2025–2027).
create or replace function private.current_congress()
returns integer
language sql
stable
as $$
  select (extract(year from now() - interval '3 days')::integer - 1789) / 2 + 1;
$$;

create or replace function private.trim_past_congresses()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_c integer := private.current_congress();
  actions integer;
  cosponsors integer;
  positions integer;
begin
  delete from public.bill_actions a using public.bills b
   where b.id = a.bill_id and b.congress < current_c;
  get diagnostics actions = row_count;
  delete from public.bill_cosponsors c using public.bills b
   where b.id = c.bill_id and b.congress < current_c;
  get diagnostics cosponsors = row_count;
  delete from public.vote_positions p using public.votes v
   where v.id = p.vote_id and v.congress < current_c;
  get diagnostics positions = row_count;
  return jsonb_build_object('congress', current_c, 'actions', actions, 'cosponsors', cosponsors, 'positions', positions);
end;
$$;

revoke all on function private.trim_past_congresses() from public, anon, authenticated;

-- Monthly, 04:17 UTC on the 5th: a no-op until the 120th Congress begins in January 2027.
select cron.schedule('trim-past-congresses', '17 4 5 * *', $$select private.trim_past_congresses()$$);
