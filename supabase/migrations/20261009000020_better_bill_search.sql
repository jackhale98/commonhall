-- Better bill search. The old search only did whole-word full-text matching over
-- titles and summaries, so "EA" matched summaries mentioning an "EA"
-- (environmental assessment) and never found the "EARA" act, and bill numbers
-- like "hr 677" were not recognised. Now, in order:
--   1. a bill number ("H.R. 677", "hr677", "s 5", "hjres 3") returns just that bill;
--   2. short titles that equal or start with the query;
--   3. titles containing every word as a word prefix ("clean wat" → "Clean Water");
--   4. ordinary full-text matches, summaries included, ranked lower;
--   5. if nothing matched, titles whose words are spelled like the query's (typos).
-- Ties go to the most recently active bill.

create extension if not exists pg_trgm with schema extensions;

create index if not exists bills_short_title_trgm_idx
  on public.bills using gin (lower(coalesce(short_title, '')) extensions.gin_trgm_ops);

create or replace function public.search_bills(q text, max_results integer default 50)
returns setof public.bills
language plpgsql
stable
set search_path = ''
as $$
declare
  raw text := btrim(coalesce(q, ''));
  clean text := lower(btrim(regexp_replace(raw, '[^[:alnum:]]+', ' ', 'g')));
  compact text := lower(regexp_replace(raw, '[^[:alnum:]]', '', 'g'));
  num text[] := regexp_match(compact, '^(hr|s|hres|sres|hjres|sjres|hconres|sconres)([0-9]+)$');
  words text[];
  prefix_query tsquery;
  web_query tsquery;
  found integer := 0;
  lim integer := least(greatest(coalesce(max_results, 50), 1), 200);
begin
  if clean = '' then
    return;
  end if;
  -- A bill number is a lookup, not a search: return that bill or nothing.
  if num is not null then
    return query
      select b.* from public.bills b
       where b.bill_type = num[1] and b.number = num[2]::integer
       order by b.congress desc
       limit lim;
    return;
  end if;
  words := regexp_split_to_array(clean, '\s+');
  -- Every word as a prefix of a title word (weight A = short title and title).
  prefix_query := to_tsquery('english', array_to_string(array(select w || ':*A' from unnest(words) w), ' & '));
  web_query := websearch_to_tsquery('english', raw);

  -- Strong matches: title prefixes and full-text.
  return query
  with scored as (
    select b.id, b.latest_action_date,
           (case when lower(coalesce(b.short_title, '')) = clean then 500
                 when lower(coalesce(b.short_title, '')) like clean || '%' then 300
                 else 0 end)
         + (case when numnode(prefix_query) > 0 and b.search @@ prefix_query
                 then 100 + 50 * ts_rank(b.search, prefix_query) else 0 end)
         + (case when numnode(web_query) > 0 and b.search @@ web_query
                 then 20 * ts_rank(b.search, web_query) else 0 end)
           as score
      from public.bills b
     where lower(coalesce(b.short_title, '')) like clean || '%'
        or (numnode(prefix_query) > 0 and b.search @@ prefix_query)
        or (numnode(web_query) > 0 and b.search @@ web_query)
     order by score desc, b.latest_action_date desc nulls last, b.id
     limit lim
  )
  select b.*
    from scored s
    join public.bills b on b.id = s.id
   order by s.score desc, s.latest_action_date desc nulls last, s.id;
  get diagnostics found = row_count;

  -- Nothing matched: probably a typo. Find titles where every word of the query is
  -- spelled like a word in the title ("vetrans housing" → "Veterans Housing").
  if found = 0 and length(clean) >= 4 then
    return query
    select b.*
      from public.bills b
     where not exists (
             select 1 from unnest(words) w
              where length(w) >= 3
                and extensions.word_similarity(w, lower(coalesce(b.short_title, '') || ' ' || b.title)) < 0.5)
     order by extensions.word_similarity(clean, lower(coalesce(b.short_title, '') || ' ' || b.title)) desc,
              b.latest_action_date desc nulls last, b.id
     limit lim;
  end if;
end;
$$;

grant execute on function public.search_bills(text, integer) to anon, authenticated;

-- Boston council matters: the same prefix matching, and docket numbers
-- ("2026-1882", "#1882", "1882") look up that matter.
create or replace function public.search_local_matters(p_city text, q text, max_results integer default 50)
returns setof public.local_matters
language plpgsql
stable
set search_path = ''
as $$
declare
  raw text := btrim(coalesce(q, ''));
  clean text := lower(btrim(regexp_replace(raw, '[^[:alnum:]]+', ' ', 'g')));
  docket text[] := regexp_match(raw, '^#?\s*(?:docket\s*#?\s*)?((?:\d{4}-)?\d{1,5})$', 'i');
  prefix_query tsquery;
  web_query tsquery;
  lim integer := least(greatest(coalesce(max_results, 50), 1), 200);
begin
  if clean = '' then
    return;
  end if;
  if docket is not null then
    return query
      select m.* from public.local_matters m
       where m.city = p_city
         and (m.file_number = docket[1] or m.file_number like '%-' || lpad(docket[1], 4, '0'))
       order by m.intro_date desc nulls last
       limit lim;
    return;
  end if;
  prefix_query := to_tsquery('english',
    array_to_string(array(select w || ':*' from unnest(regexp_split_to_array(clean, '\s+')) w), ' & '));
  web_query := websearch_to_tsquery('english', raw);
  return query
    select m.* from public.local_matters m
     where m.city = p_city
       and ((numnode(prefix_query) > 0 and m.search @@ prefix_query)
            or (numnode(web_query) > 0 and m.search @@ web_query))
     order by (case when numnode(prefix_query) > 0 and m.search @@ prefix_query then 1 else 0 end) desc,
              ts_rank(m.search, case when numnode(web_query) > 0 then web_query else prefix_query end) desc,
              m.latest_action_date desc nulls last
     limit lim;
end;
$$;

grant execute on function public.search_local_matters(text, text, integer) to anon, authenticated;

-- Short titles "for portions of this bill" were sometimes picked as a bill's
-- title (H.R. 1 showed as "FEHB Protection Act of 2025"). The sync now skips
-- them; titles_rev marks bills whose title was picked by the current rule, and
-- sync-committees re-checks the rest in hourly batches.
alter table public.bills add column titles_rev smallint not null default 0;
comment on column public.bills.titles_rev is 'Version of the short-title rule last applied (TITLES_REV in packages/sync).';
update public.bills set titles_rev = 1 where titles_count = 0;
create index bills_titles_rev_idx on public.bills (latest_action_date desc) where titles_rev < 1;
