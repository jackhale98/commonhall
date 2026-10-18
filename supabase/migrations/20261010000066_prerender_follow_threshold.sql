-- Prebuilt pages for followed items need two followers (review item 11; CLAUDE.md
-- "Growth and free tiers"; docs/decisions.md §108). Every followed bill, state bill
-- and council item got its own prebuilt page, so one account following 500 bills
-- added 500 pages to the site. followed_targets now counts followers (still no user
-- ids), and an item followed by one account opens from the client-rendered fallback
-- page instead, as items newer than the last build already do.
--
-- No upstream requests.

alter table public.followed_targets add column followers integer not null default 1;
comment on column public.followed_targets.followers is 'How many accounts follow the item (no user ids).';

update public.followed_targets t
   set followers = (select count(*) from public.follows f where f.target_type = t.target_type and f.target_id = t.target_id);

create or replace function private.sync_followed_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.followed_targets as t (target_type, target_id, followers)
    values (new.target_type, new.target_id, 1)
    on conflict (target_type, target_id) do update set followers = t.followers + 1;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    update public.followed_targets set followers = followers - 1
     where target_type = old.target_type and target_id = old.target_id;
    delete from public.followed_targets where target_type = old.target_type and target_id = old.target_id and followers <= 0;
  end if;
  return null;
end;
$$;

create or replace view public.bills_prerender
with (security_invoker = true)
as
select b.id, b.congress
  from public.bills b
 where b.status not in ('introduced', 'in_committee')
    or exists (
      select 1 from public.bill_actions a
       where a.bill_id = b.id
         and a.text ~* '(reported by|ordered to be reported|reported (with|without) amendment|reported an original measure|placed on (the )?(union|house) calendar|placed on senate legislative calendar)'
    )
    or exists (select 1 from public.discussions d where d.target_type = 'bill' and d.target_id = b.id and d.status <> 'draft')
    or exists (select 1 from public.followed_targets f where f.target_type = 'bill' and f.followers >= 2 and f.target_id = b.id);

create or replace view public.state_bills_prerender
with (security_invoker = true)
as
select s.id, s.state
  from public.state_bills s
 where (
         s.state = 'MA'
         and (
           s.latest_passage_date is not null
           or s.latest_action_text ~* '(reported|passed|enacted|signed|chapter|ought to pass|accompanied a new draft|third reading|engrossed)'
         )
       )
    or (
         s.state = 'CT'
         and (
           s.latest_passage_date is not null
           or s.latest_action_text ~* '(passed|public act|special act|signed|vetoed|transmitted to the governor)'
         )
       )
    or exists (select 1 from public.discussions d where d.target_type = 'state_bill' and d.target_id = s.id and d.status <> 'draft')
    or exists (select 1 from public.followed_targets f where f.target_type = 'state_bill' and f.followers >= 2 and f.target_id = s.id);

create or replace view public.local_matters_prerender
with (security_invoker = true)
as
select m.id, m.city
  from public.local_matters m
 where exists (select 1 from public.discussions d where d.target_type = 'local_matter' and d.target_id = m.id and d.status <> 'draft')
    or exists (select 1 from public.followed_targets f where f.target_type = 'local_matter' and f.followers >= 2 and f.target_id = m.id);
