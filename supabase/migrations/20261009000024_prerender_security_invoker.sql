-- The prerender views ran with their owner's rights (SECURITY DEFINER) so they
-- could see every user's follows, which RLS otherwise limits to their owner.
-- Supabase's linter flags that, rightly: such a view bypasses RLS for whoever
-- queries it. Instead, the fact the views need ("at least one user follows this
-- item", never who) is kept in its own table by a trigger, and the views run with
-- the caller's rights.

create table public.followed_targets (
  target_type text not null,
  target_id text not null,
  primary key (target_type, target_id)
);

comment on table public.followed_targets is
  'Items with at least one follower (no user ids), kept by a trigger on follows; used to choose prerendered pages.';

alter table public.followed_targets enable row level security;
create policy "Public read" on public.followed_targets for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.followed_targets from anon, authenticated;

create or replace function private.sync_followed_targets()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.followed_targets (target_type, target_id)
    values (new.target_type, new.target_id)
    on conflict do nothing;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.followed_targets t
     where t.target_type = old.target_type and t.target_id = old.target_id
       and not exists (
         select 1 from public.follows f where f.target_type = old.target_type and f.target_id = old.target_id
       );
  end if;
  return null;
end;
$$;

revoke all on function private.sync_followed_targets() from public, anon, authenticated;

create trigger follows_sync_followed_targets
  after insert or update of target_type, target_id or delete on public.follows
  for each row execute function private.sync_followed_targets();

insert into public.followed_targets (target_type, target_id)
select distinct target_type, target_id from public.follows
on conflict do nothing;

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
    or exists (select 1 from public.followed_targets f where f.target_type = 'bill' and f.target_id = b.id);

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
    or exists (select 1 from public.discussions d where d.target_type = 'state_bill' and d.target_id = s.id and d.status <> 'draft')
    or exists (select 1 from public.followed_targets f where f.target_type = 'state_bill' and f.target_id = s.id);

create or replace view public.local_matters_prerender
with (security_invoker = true)
as
select m.id, m.city
  from public.local_matters m
 where exists (select 1 from public.discussions d where d.target_type = 'local_matter' and d.target_id = m.id and d.status <> 'draft')
    or exists (select 1 from public.followed_targets f where f.target_type = 'local_matter' and f.target_id = m.id);
