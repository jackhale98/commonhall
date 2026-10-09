-- Counts for the Boston council matters filters, given the other filters: type
-- counts respect the chosen status, sponsor and search; status counts respect the
-- chosen type, sponsor and search. So "Passed (n)" always matches what you'd see.

create or replace function public.local_matter_facets(
  p_city text,
  p_type text default null,
  p_status text default null,
  p_sponsor text default null,
  p_q text default null)
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
   where status is not null and (p_type is null or type = p_type)
   group by status;
$$;

grant execute on function public.local_matter_facets(text, text, text, text, text) to anon, authenticated;
