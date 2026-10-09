-- Saved locations keep no street address. Everything that uses a saved location (the
-- feed, residency for discussions) works from the districts; the label only reminds
-- the user which place they saved, so it is cut to city, state and ZIP
-- ("1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500" → "Washington, DC 20500").
-- A trigger applies this to every write, so no client (an old cached page included)
-- can store a street; existing labels are cut the same way.

create or replace function private.area_label(label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  if label is null then
    return null;
  end if;
  select coalesce(array_agg(btrim(p)) filter (where btrim(p) <> ''), '{}') into parts
    from unnest(string_to_array(label, ',')) as p;
  -- "STREET, CITY, ST, ZIP" or "STREET, CITY, ST": drop the street.
  if cardinality(parts) >= 4 or (cardinality(parts) >= 2 and parts[1] ~ '^\d') then
    parts := parts[2:];
  end if;
  if cardinality(parts) >= 3 and parts[2] ~ '^[A-Za-z]{2}$' then
    return initcap(parts[1]) || ', ' || upper(parts[2]) || coalesce(' ' || substring(parts[3] from '^\d{5}'), '');
  end if;
  if cardinality(parts) = 2 and parts[1] !~ '\d' and parts[2] ~ '^[A-Za-z]{2}( \d{5})?$' then
    return initcap(parts[1]) || ', ' || upper(parts[2]);
  end if;
  -- Anything else might hold a street: keep nothing rather than guess.
  return null;
end;
$$;

comment on function private.area_label(text) is
  'City, state and ZIP from an address; null when that cannot be told apart from a street.';

-- Security definer: it runs on users' own writes, and users cannot reach the private
-- schema. It only rewrites the label of the row being written.
create or replace function private.profiles_area_label()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.address_label := private.area_label(new.address_label);
  return new;
end;
$$;

create trigger profiles_area_label
  before insert or update of address_label on public.profiles
  for each row execute function private.profiles_area_label();

update public.profiles set address_label = private.area_label(address_label) where address_label is not null;

comment on column public.profiles.address_label is
  'City, state and ZIP of the saved location (never a street address); shown back to the user only.';
