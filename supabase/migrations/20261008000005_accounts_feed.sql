-- Phase 3: accounts, follows and the activity feed.
--
-- User tables are protected by RLS (user_id = auth.uid()). Feed events are public
-- facts about bills and members, written once per change (not per follower), so
-- storage does not grow with users. The `feed` view joins them to the caller's
-- follows.

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  address_label text,
  state char(2),
  congressional_district smallint,
  state_upper_district text,
  state_lower_district text,
  updated_at timestamptz not null default now()
);

comment on column public.profiles.address_label is 'What the user typed or the matched address; shown back to them only.';

create table public.follows (
  user_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('bill', 'member', 'state_bill', 'state_legislator')),
  target_id text not null check (length(target_id) between 1 and 200),
  created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id)
);

create index follows_target_idx on public.follows (target_type, target_id);

create table public.feed_events (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('bill', 'member', 'state_bill', 'state_legislator')),
  target_id text not null,
  kind text not null check (kind in ('action', 'vote', 'cosponsor', 'new_bill')),
  -- The legislator the event is about, if any (sponsor of a new bill, a new cosponsor):
  -- lets followers of that legislator see it too.
  member_type text check (member_type in ('member', 'state_legislator')),
  member_id text,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique
);

comment on column public.feed_events.occurred_at is 'When it happened upstream (for ordering and display).';
comment on column public.feed_events.created_at is 'When we recorded it; "unread" compares this with feed_reads.last_seen_at.';
comment on column public.feed_events.dedupe_key is 'Makes event writes idempotent across reruns.';

create index feed_events_target_idx on public.feed_events (target_type, target_id, occurred_at desc);
create index feed_events_member_idx on public.feed_events (member_type, member_id, occurred_at desc) where member_id is not null;

create table public.feed_reads (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.follows enable row level security;
alter table public.feed_events enable row level security;
alter table public.feed_reads enable row level security;

-- Own rows only. (select auth.uid()) is evaluated once per statement.
create policy "Own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own follows" on public.follows for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own read marker" on public.feed_reads for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Public read" on public.feed_events for select to anon, authenticated using (true);

revoke all on public.profiles, public.follows, public.feed_reads from anon;
revoke insert, update, delete, truncate on public.feed_events from anon, authenticated;

-- A user may follow at most 500 things (keeps the feed query cheap and limits abuse).
create or replace function private.enforce_follow_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.follows where user_id = new.user_id) >= 500 then
    raise exception 'You can follow at most 500 items' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger follows_limit before insert on public.follows
  for each row execute function private.enforce_follow_limit();

-- The caller's feed: events on things they follow, plus events about legislators
-- they follow (bills those legislators introduced or cosponsored). Runs with the
-- caller's privileges, so RLS on follows limits it to their own follows.
create or replace view public.feed
with (security_invoker = true)
as
with mine as (
  select target_type, target_id from public.follows where user_id = (select auth.uid())
),
seen as (
  select last_seen_at from public.feed_reads where user_id = (select auth.uid())
),
matched as (
  select e.*, 'target'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.target_type and m.target_id = e.target_id
  union
  select e.*, 'legislator'::text as reason
    from public.feed_events e
    join mine m on m.target_type = e.member_type and m.target_id = e.member_id
)
select distinct on (m.id)
  m.id, m.target_type, m.target_id, m.kind, m.member_type, m.member_id, m.occurred_at, m.created_at,
  m.summary, m.payload, m.reason,
  m.created_at > coalesce((select last_seen_at from seen), '-infinity'::timestamptz) as unread
from matched m
order by m.id, m.reason desc;

comment on view public.feed is 'Feed for the signed-in user; order by occurred_at desc, id desc.';

grant select on public.feed to authenticated;
revoke all on public.feed from anon;

-- Unread count for the header badge, without fetching the feed.
create or replace function public.feed_unread_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer from public.feed where unread;
$$;

revoke all on function public.feed_unread_count() from public, anon;
grant execute on function public.feed_unread_count() to authenticated;
