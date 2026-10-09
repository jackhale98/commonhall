-- Boston council matters: consent-agenda resolutions (mostly congratulations and
-- commendations, about 70% of all matters) are hidden from the list by default.
-- The facets take the hidden types so the status counts match the default list;
-- the type counts still include every type, so the hidden ones can be chosen.

drop function if exists public.local_matter_facets(text, text, text, text, text);

create function public.local_matter_facets(
  p_city text,
  p_type text default null,
  p_status text default null,
  p_sponsor text default null,
  p_q text default null,
  p_exclude_types text[] default null)
returns table (facet text, value text, n integer)
language sql
stable
set search_path = ''
as $$
  with base as (
    select m.type, m.status
      from public.local_matters m
     where m.city = p_city
       and (p_sponsor is null or exists (
             select 1 from public.local_matter_sponsors s where s.matter_id = m.id and s.official_id = p_sponsor))
       and (coalesce(btrim(p_q), '') = '' or m.id in (
             select r.id from public.search_local_matters(p_city, p_q, 200) r))
  )
  select 'type', type, count(*)::integer from base
   where type is not null and (p_status is null or status = p_status)
   group by type
  union all
  select 'status', status, count(*)::integer from base
   where status is not null
     and (case when p_type is not null then type = p_type
               else p_exclude_types is null or type is null or type <> all (p_exclude_types) end)
   group by status;
$$;

grant execute on function public.local_matter_facets(text, text, text, text, text, text[]) to anon, authenticated;
