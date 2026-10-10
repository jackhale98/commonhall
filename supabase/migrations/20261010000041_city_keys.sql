-- Cities are keyed by state and name ("ma-boston", "ma-worcester") so two towns with
-- the same name in different states can't collide. The key is the `city` value and
-- the prefix of every id that belongs to a city; discussions use it as jurisdiction.

-- Renaming a parent id carries to its children.
alter table public.local_matter_actions drop constraint local_matter_actions_matter_id_fkey,
  add constraint local_matter_actions_matter_id_fkey foreign key (matter_id)
    references public.local_matters (id) on delete cascade on update cascade;
alter table public.local_matter_sponsors drop constraint local_matter_sponsors_matter_id_fkey,
  add constraint local_matter_sponsors_matter_id_fkey foreign key (matter_id)
    references public.local_matters (id) on delete cascade on update cascade;
alter table public.local_vote_positions drop constraint local_vote_positions_vote_id_fkey,
  add constraint local_vote_positions_vote_id_fkey foreign key (vote_id)
    references public.local_votes (id) on delete cascade on update cascade;
alter table public.local_meeting_items drop constraint local_meeting_items_meeting_id_fkey,
  add constraint local_meeting_items_meeting_id_fkey foreign key (meeting_id)
    references public.local_meetings (id) on delete cascade on update cascade;
alter table public.local_committee_members drop constraint local_committee_members_committee_id_fkey,
  add constraint local_committee_members_committee_id_fkey foreign key (committee_id)
    references public.local_committees (id) on delete cascade on update cascade;

alter table public.local_officials drop constraint local_officials_id_check;
alter table public.local_matters drop constraint local_matters_id_check;
alter table public.local_votes drop constraint local_votes_id_check;

-- Prefix a city's ids and city values once (idempotent: already-prefixed rows are left alone).
create function pg_temp.key(v text) returns text language sql immutable as $$
  select case when v is null or v ~ '^[a-z]{2}-' then v else 'ma-' || v end
$$;

update public.local_officials set id = pg_temp.key(id), city = pg_temp.key(city);
update public.local_matters set id = pg_temp.key(id), city = pg_temp.key(city);
update public.local_matter_sponsors set official_id = pg_temp.key(official_id);
update public.local_meetings set id = pg_temp.key(id), city = pg_temp.key(city);
update public.local_meeting_items set matter_id = pg_temp.key(matter_id);
update public.local_votes set id = pg_temp.key(id), city = pg_temp.key(city),
  matter_id = pg_temp.key(matter_id), meeting_id = pg_temp.key(meeting_id);
update public.local_vote_positions set official_id = pg_temp.key(official_id);
update public.local_committees set id = pg_temp.key(id), city = pg_temp.key(city);
update public.local_committee_members set official_id = pg_temp.key(official_id);
update public.council_districts set city = pg_temp.key(city);
update public.local_capital_items set city = pg_temp.key(city);
update public.local_capital_documents set city = pg_temp.key(city);
update public.local_operating_documents set city = pg_temp.key(city);
update public.local_operating_lines set city = pg_temp.key(city);
update public.profiles set city = pg_temp.key(city) where city is not null;

alter table public.local_officials add constraint local_officials_id_check
  check (id ~ '^[a-z]{2}-[a-z]+(-[a-z]+)*-(p[0-9]+|[a-z0-9-]+)$');
alter table public.local_matters add constraint local_matters_id_check check (id ~ '^[a-z]{2}-[a-z-]+-[0-9]+$');
alter table public.local_votes add constraint local_votes_id_check check (id ~ '^[a-z]{2}-[a-z-]+-ei[0-9]+$');

comment on column public.local_officials.id is
  '{city key}-p{Legistar PersonId} (ma-boston-p324) or {city key}-{name slug} (ma-worcester-gary-rosen)';

-- Capital projects: Boston's by the city's project id, Worcester's by department-and-title slug.
create function pg_temp.project(v text) returns text language sql immutable as $$
  select case when v ~ '^[a-z]{2}-' then v when v like 'worcester-%' then 'ma-' || v else 'ma-boston-' || v end
$$;

-- Ids pointing at city things from elsewhere.
do $$
declare t text;
begin
  foreach t in array array['follows', 'feed_events', 'discussions', 'discussion_requests', 'discussion_requests_anon'] loop
    execute format(
      'update public.%I set target_id = pg_temp.key(target_id) where target_type in (''local_matter'', ''local_official'')', t);
    execute format(
      'update public.%I set target_id = pg_temp.project(target_id) where target_type = ''capital_project''', t);
  end loop;
end $$;
update public.feed_events set member_id = pg_temp.key(member_id) where member_type = 'local_official';

alter table public.discussions drop constraint discussions_jurisdiction_check;
alter table public.discussions drop constraint discussions_district_check;
update public.discussions set jurisdiction = pg_temp.key(jurisdiction) where jurisdiction in ('boston', 'worcester');
alter table public.discussions add constraint discussions_jurisdiction_check
  check (jurisdiction ~ '^(federal|[a-z]{2}|[a-z]{2}-[a-z-]+)$');
alter table public.discussions add constraint discussions_district_check
  check (district is null or jurisdiction ~ '^[a-z]{2}-[a-z-]+$');
comment on column public.discussions.jurisdiction is 'federal, a state code (ma) or a city key (ma-boston).';

-- Boston's other datasets carry their city too, so pages read every city the same way.
alter table public.capital_projects add column city text not null default 'ma-boston';
alter table public.city_budget_lines add column city text not null default 'ma-boston';
alter table public.zba_appeals add column city text not null default 'ma-boston';
alter table public.zba_decision_counts add column city text not null default 'ma-boston';
alter table public.boston_311_daily add column city text not null default 'ma-boston';
