-- Boston City Council committees. Legistar files committee hearings under the City
-- Council and names the committee only in the meeting's location text; the sync now
-- reads it into `committees` (empty for a full council meeting; two for a joint
-- hearing) and keeps each meeting's agenda items, so a committee's page can list
-- its hearings and the dockets they took up.
alter table public.local_meetings add column committees text[] not null default '{}';
create index local_meetings_committees_idx on public.local_meetings using gin (committees);

create table public.local_meeting_items (
  meeting_id text not null references public.local_meetings (id) on delete cascade,
  seq smallint not null,
  -- The council matter, when the item is one (no foreign key: we keep only legislative types).
  matter_id text,
  file_number text,
  title text not null,
  primary key (meeting_id, seq)
);
create index local_meeting_items_matter_idx on public.local_meeting_items (matter_id) where matter_id is not null;

alter table public.local_meeting_items enable row level security;
create policy "Public read" on public.local_meeting_items for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.local_meeting_items from anon, authenticated;
grant select on public.local_meeting_items to anon, authenticated;
