-- Simplified council district outlines for maps on the site (build time and browser).
create or replace function public.council_district_shapes(p_city text)
returns table (district smallint, name text, geojson text)
language sql
stable
set search_path = ''
as $$
  select d.district, d.name,
         extensions.st_asgeojson(extensions.st_simplifypreservetopology(d.geometry, 0.0002), 5)
    from public.council_districts d
   where d.city = p_city
   order by d.district;
$$;

grant execute on function public.council_district_shapes(text) to anon, authenticated;
