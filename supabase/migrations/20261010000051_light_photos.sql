-- Lighter official photos. Legislators' and officials' photos are hotlinked from their
-- sources, and some are huge (a 10 MB lieutenant governor portrait, 700 KB PNGs shown
-- at 40 px). The weekly people loader checks each photo once and records what to use
-- instead: the source's own smaller copy (a Wikimedia thumbnail, a WordPress
-- 150×150), the original when it is small enough, or nothing (initials) when it is
-- too heavy. A trigger applies the choice on every write, so the hourly state sync,
-- which writes the original URL, can't bring the heavy one back.

create table private.photo_variants (
  url text primary key,
  -- What to show instead; null means no photo (too heavy, no smaller copy).
  use_url text,
  bytes integer,
  checked_at timestamptz not null default now()
);

comment on table private.photo_variants is 'Official photo URL → the lighter URL to show (or null), from scripts/load-state-people.ts.';

create or replace function private.light_photo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v private.photo_variants;
begin
  if new.photo_url is not null then
    select * into v from private.photo_variants where url = new.photo_url;
    if found then
      new.photo_url := v.use_url;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.light_photo() from public, anon, authenticated;

create trigger light_photo before insert or update of photo_url on public.state_legislators
  for each row execute function private.light_photo();
create trigger light_photo before insert or update of photo_url on public.state_executives
  for each row execute function private.light_photo();
create trigger light_photo before insert or update of photo_url on public.local_officials
  for each row execute function private.light_photo();
