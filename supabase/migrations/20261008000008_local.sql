-- Boston City Council (local government). Tables carry a `city` column so more
-- cities can be added later. Public read, service-role write.

create extension if not exists postgis with schema extensions;

create table public.local_officials (
  id text primary key check (id ~ '^[a-z]+-p[0-9]+$'),
  city text not null,
  person_id integer not null,
  name text not null,
  first_name text,
  last_name text,
  seat text,
  district smallint,
  title text,
  email text,
  photo_url text,
  start_date date,
  end_date date,
  current boolean not null default true,
  updated_at timestamptz not null default now()
);

comment on column public.local_officials.id is '{city}-p{Legistar PersonId}, e.g. boston-p324';
comment on column public.local_officials.seat is 'e.g. "District 7" or "At-Large"; from the seat map, not Legistar (which has no seat data).';

create index local_officials_city_idx on public.local_officials (city, current, district);

create table public.local_matters (
  id text primary key check (id ~ '^[a-z]+-[0-9]+$'),
  city text not null,
  matter_id integer not null,
  file_number text,
  title text not null,
  type text,
  status text,
  body text,
  intro_date date,
  agenda_date date,
  passed_date date,
  legistar_url text,
  last_modified timestamptz,
  latest_action_date date,
  latest_action_text text,
  synced_at timestamptz not null default now(),
  search tsvector generated always as (
    setweight(to_tsvector('english', coalesce(file_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(title, '')), 'B')
  ) stored
);

comment on column public.local_matters.id is '{city}-{Legistar MatterId}, e.g. boston-43547';

create index local_matters_city_modified_idx on public.local_matters (city, last_modified desc);
create index local_matters_city_action_idx on public.local_matters (city, latest_action_date desc nulls last);
create index local_matters_search_idx on public.local_matters using gin (search);

create table public.local_matter_actions (
  matter_id text not null references public.local_matters (id) on delete cascade,
  seq integer not null,
  action_date date,
  action_name text,
  action_text text,
  body text,
  passed text,
  event_id integer,
  primary key (matter_id, seq)
);

create table public.local_matter_sponsors (
  matter_id text not null references public.local_matters (id) on delete cascade,
  official_id text not null,
  name text,
  sequence integer,
  primary key (matter_id, official_id)
);

comment on column public.local_matter_sponsors.official_id is 'May refer to a former official not in local_officials.';

create index local_matter_sponsors_official_idx on public.local_matter_sponsors (official_id);

create table public.local_meetings (
  id text primary key,
  city text not null,
  event_id integer not null,
  body text,
  starts_at timestamptz,
  date date not null,
  time text,
  location text,
  agenda_url text,
  minutes_url text,
  legistar_url text,
  status text,
  last_modified timestamptz
);

create index local_meetings_city_date_idx on public.local_meetings (city, date desc);

create table public.local_votes (
  id text primary key check (id ~ '^[a-z]+-ei[0-9]+$'),
  city text not null,
  matter_id text,
  meeting_id text,
  meeting_date date,
  question text,
  result text,
  yea_total integer not null default 0,
  nay_total integer not null default 0,
  present_total integer not null default 0,
  absent_total integer not null default 0,
  source_url text,
  created_at timestamptz not null default now()
);

comment on table public.local_votes is 'Roll calls recorded in Legistar. Boston currently records none there (see docs/decisions.md).';

create index local_votes_matter_idx on public.local_votes (matter_id);

create table public.local_vote_positions (
  vote_id text not null references public.local_votes (id) on delete cascade,
  official_id text not null,
  position text not null check (position in ('yea', 'nay', 'present', 'not_voting')),
  primary key (vote_id, official_id)
);

create index local_vote_positions_official_idx on public.local_vote_positions (official_id);

create table public.council_districts (
  city text not null,
  district smallint not null,
  name text,
  geometry extensions.geometry(MultiPolygon, 4326) not null,
  source text,
  source_updated date,
  primary key (city, district)
);

create index council_districts_geometry_idx on public.council_districts using gist (geometry);

-- The council district containing a point, or null outside the city.
create or replace function public.council_district_at(p_city text, p_lat double precision, p_lng double precision)
returns smallint
language sql
stable
set search_path = ''
as $$
  select d.district from public.council_districts d
   where d.city = p_city
     and extensions.st_contains(d.geometry, extensions.st_setsrid(extensions.st_point(p_lng, p_lat), 4326))
   limit 1;
$$;

grant execute on function public.council_district_at(text, double precision, double precision) to anon, authenticated, service_role;

-- Search council matters (PostgREST: /rpc/search_local_matters).
create or replace function public.search_local_matters(p_city text, q text, max_results integer default 50)
returns setof public.local_matters
language sql
stable
set search_path = ''
as $$
  select m.* from public.local_matters m
   where m.city = p_city and m.search @@ websearch_to_tsquery('english', q)
   order by ts_rank(m.search, websearch_to_tsquery('english', q)) desc, m.latest_action_date desc nulls last
   limit least(greatest(max_results, 1), 200);
$$;

grant execute on function public.search_local_matters(text, text, integer) to anon, authenticated;

alter table public.local_officials enable row level security;
alter table public.local_matters enable row level security;
alter table public.local_matter_actions enable row level security;
alter table public.local_matter_sponsors enable row level security;
alter table public.local_meetings enable row level security;
alter table public.local_votes enable row level security;
alter table public.local_vote_positions enable row level security;
alter table public.council_districts enable row level security;

create policy "Public read" on public.local_officials for select to anon, authenticated using (true);
create policy "Public read" on public.local_matters for select to anon, authenticated using (true);
create policy "Public read" on public.local_matter_actions for select to anon, authenticated using (true);
create policy "Public read" on public.local_matter_sponsors for select to anon, authenticated using (true);
create policy "Public read" on public.local_meetings for select to anon, authenticated using (true);
create policy "Public read" on public.local_votes for select to anon, authenticated using (true);
create policy "Public read" on public.local_vote_positions for select to anon, authenticated using (true);
create policy "Public read" on public.council_districts for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.local_officials, public.local_matters, public.local_matter_actions,
  public.local_matter_sponsors, public.local_meetings, public.local_votes, public.local_vote_positions,
  public.council_districts from anon, authenticated;

-- Follows, feed events and profiles learn about local items.
alter table public.follows drop constraint follows_target_type_check;
alter table public.follows add constraint follows_target_type_check check (
  target_type in ('bill', 'member', 'state_bill', 'state_legislator', 'local_matter', 'local_official', 'discussion')
);

alter table public.feed_events drop constraint feed_events_target_type_check;
alter table public.feed_events add constraint feed_events_target_type_check check (
  target_type in ('bill', 'member', 'state_bill', 'state_legislator', 'local_matter', 'local_official', 'discussion')
);
alter table public.feed_events drop constraint feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check check (
  kind in ('action', 'vote', 'cosponsor', 'new_bill', 'new_item', 'discussion_opened')
);
alter table public.feed_events drop constraint feed_events_member_type_check;
alter table public.feed_events add constraint feed_events_member_type_check check (
  member_type in ('member', 'state_legislator', 'local_official')
);

alter table public.profiles add column city text;
alter table public.profiles add column council_district smallint;

-- Feed: add followed local officials' recorded votes.
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
),
official_votes as (
  select null::bigint as id, 'local_official'::text as target_type, p.official_id as target_id, 'vote'::text as kind,
         'local_official'::text as member_type, p.official_id as member_id,
         coalesce(v.meeting_date::timestamptz, v.created_at) as occurred_at, v.created_at,
         format('%s voted %s: %s', o.name,
                case p.position when 'yea' then 'yes' when 'nay' then 'no' when 'present' then 'present' else 'did not vote' end,
                coalesce(v.question, 'council vote')) as summary,
         jsonb_build_object('local_vote_id', v.id, 'position', p.position, 'result', v.result, 'matter_id', v.matter_id) as payload,
         'legislator'::text as reason
    from mine m
    join public.local_vote_positions p on m.target_type = 'local_official' and p.official_id = m.target_id
    join public.local_votes v on v.id = p.vote_id
    join public.local_officials o on o.id = p.official_id
)
select x.*, x.created_at > (select at from seen) as unread
  from (select * from events union all select * from member_votes union all select * from official_votes) x;

grant select on public.feed to authenticated;
revoke all on public.feed from anon;

-- Nightly Boston sync, after midnight Eastern.
select cron.schedule('sync-boston', '12,42 5-6 * * *', $$select private.invoke_sync('sync-boston')$$);
