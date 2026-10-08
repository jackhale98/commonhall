-- Phase 4: House and Senate roll-call votes.

create table public.votes (
  id text primary key check (id ~ '^(house|senate)-[0-9]+-[12]-[0-9]+$'),
  chamber text not null check (chamber in ('house', 'senate')),
  congress smallint not null,
  session smallint not null check (session in (1, 2)),
  roll_number integer not null,
  date timestamptz,
  question text,
  title text,
  vote_type text,
  majority_requirement text,
  result text,
  bill_id text,
  amendment text,
  yea_total integer not null default 0,
  nay_total integer not null default 0,
  present_total integer not null default 0,
  not_voting_total integer not null default 0,
  source_url text,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chamber, congress, session, roll_number)
);

comment on column public.votes.id is '{chamber}-{congress}-{session}-{roll number}, e.g. house-119-2-80';
comment on column public.votes.bill_id is 'The bill voted on, if any (no foreign key: the bill may predate our data).';
comment on column public.votes.source_updated_at is 'Upstream update time (House) used to detect corrections.';

create index votes_bill_idx on public.votes (bill_id) where bill_id is not null;
create index votes_date_idx on public.votes (date desc);

create table public.vote_positions (
  vote_id text not null references public.votes (id) on delete cascade,
  member_id text not null references public.members (bioguide_id),
  position text not null check (position in ('yea', 'nay', 'present', 'not_voting')),
  party char(1),
  primary key (vote_id, member_id)
);

comment on column public.vote_positions.party is 'Party letter recorded with the vote (members can switch parties).';

create index vote_positions_member_idx on public.vote_positions (member_id);

alter table public.votes enable row level security;
alter table public.vote_positions enable row level security;
create policy "Public read" on public.votes for select to anon, authenticated using (true);
create policy "Public read" on public.vote_positions for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.votes, public.vote_positions from anon, authenticated;

-- A member's votes with the vote's details, for member pages (order by date desc).
create or replace view public.member_votes
with (security_invoker = true)
as
select p.member_id, p.position, p.party, v.id as vote_id, v.chamber, v.congress, v.session, v.roll_number, v.date,
       v.question, v.title, v.result, v.bill_id, v.yea_total, v.nay_total
  from public.vote_positions p
  join public.votes v on v.id = p.vote_id;

grant select on public.member_votes to anon, authenticated;

-- Per member and Congress: votes cast, missed, and how often they voted with the
-- majority of their own party (counting only votes where that majority was yea or nay).
create or replace view public.member_vote_stats
with (security_invoker = true)
as
with party_majority as (
  select vote_id, party,
         case
           when count(*) filter (where position = 'yea') > count(*) filter (where position = 'nay') then 'yea'
           when count(*) filter (where position = 'nay') > count(*) filter (where position = 'yea') then 'nay'
         end as majority
    from public.vote_positions
   where party in ('D', 'R') and position in ('yea', 'nay')
   group by vote_id, party
)
select p.member_id,
       v.congress,
       count(*)::integer as total_votes,
       (count(*) filter (where p.position in ('yea', 'nay')))::integer as votes_cast,
       (count(*) filter (where p.position = 'not_voting'))::integer as missed,
       (count(*) filter (where p.position in ('yea', 'nay') and pm.majority = p.position))::integer as with_party,
       (count(*) filter (where p.position in ('yea', 'nay') and pm.majority is not null))::integer as party_line_votes
  from public.vote_positions p
  join public.votes v on v.id = p.vote_id
  left join party_majority pm on pm.vote_id = p.vote_id and pm.party = p.party
 group by p.member_id, v.congress;

grant select on public.member_vote_stats to anon, authenticated;

-- Feed: add followed members' votes, joined from vote_positions (no per-member rows).
create or replace view public.feed
with (security_invoker = true)
as
with mine as (
  select target_type, target_id from public.follows where user_id = (select auth.uid())
),
seen as (
  select coalesce((select last_seen_at from public.feed_reads where user_id = (select auth.uid())), '-infinity'::timestamptz) as at
),
matched as (
  select e.*, 'target'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.target_type and m.target_id = e.target_id
  union
  select e.*, 'legislator'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.member_type and m.target_id = e.member_id
),
events as (
  select distinct on (m.id)
    m.id, m.target_type, m.target_id, m.kind, m.member_type, m.member_id, m.occurred_at, m.created_at,
    m.summary, m.payload, m.reason
  from matched m
  order by m.id, m.reason desc
),
member_votes as (
  select null::bigint as id, 'member'::text as target_type, p.member_id as target_id, 'vote'::text as kind,
         'member'::text as member_type, p.member_id, coalesce(v.date, v.created_at) as occurred_at, v.created_at,
         format('%s voted %s: %s', mem.name,
                case p.position when 'yea' then 'yes' when 'nay' then 'no' when 'present' then 'present' else 'did not vote' end,
                coalesce(v.question, 'roll call ' || v.roll_number)) as summary,
         jsonb_build_object('vote_id', v.id, 'position', p.position, 'result', v.result, 'bill_id', v.bill_id,
                            'chamber', v.chamber, 'question', v.question) as payload,
         'legislator'::text as reason
    from mine m
    join public.vote_positions p on m.target_type = 'member' and p.member_id = m.target_id
    join public.votes v on v.id = p.vote_id
    join public.members mem on mem.bioguide_id = p.member_id
)
select x.*, x.created_at > (select at from seen) as unread
  from (select * from events union all select * from member_votes) x;

comment on view public.feed is 'Feed for the signed-in user; order by occurred_at desc. Member-vote rows have a null id.';

grant select on public.feed to authenticated;
revoke all on public.feed from anon;
