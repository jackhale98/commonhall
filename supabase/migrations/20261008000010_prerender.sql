-- Hybrid rendering: which items get a prerendered page at build time.
--
-- "Notable" = a federal or state bill reported by committee or further along, any
-- item linked to a published discussion, or anything followed by at least one
-- user. Everything else is served by client-rendered fallback routes.
--
-- These views expose ids only. They run with the owner's privileges (not
-- security_invoker) so they can count follows across users without revealing who
-- follows what.

create or replace view public.bills_prerender as
select b.id, b.congress
  from public.bills b
 where b.status not in ('introduced', 'in_committee')
    or exists (
      select 1 from public.bill_actions a
       where a.bill_id = b.id
         and a.text ~* '(reported by|ordered to be reported|reported (with|without) amendment|reported an original measure|placed on (the )?(union|house) calendar|placed on senate legislative calendar)'
    )
    or exists (select 1 from public.discussions d where d.target_type = 'bill' and d.target_id = b.id and d.status <> 'draft')
    or exists (select 1 from public.follows f where f.target_type = 'bill' and f.target_id = b.id);

comment on view public.bills_prerender is 'Federal bills that get a prerendered page (see docs/decisions.md).';

-- State bills: the same rule for Massachusetts (first-class state); other states
-- only when followed or discussed, to keep the built site under its size budget.
create or replace view public.state_bills_prerender as
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
    or exists (select 1 from public.follows f where f.target_type = 'state_bill' and f.target_id = s.id);

comment on view public.state_bills_prerender is 'State bills that get a prerendered page.';

create or replace view public.local_matters_prerender as
select m.id, m.city
  from public.local_matters m
 where exists (select 1 from public.discussions d where d.target_type = 'local_matter' and d.target_id = m.id and d.status <> 'draft')
    or exists (select 1 from public.follows f where f.target_type = 'local_matter' and f.target_id = m.id);

comment on view public.local_matters_prerender is 'Council matters that get a prerendered page.';

grant select on public.bills_prerender, public.state_bills_prerender, public.local_matters_prerender to anon, authenticated;

-- Active cosponsorships per member and Congress (member pages), counted in the database.
create or replace view public.member_cosponsor_counts
with (security_invoker = true)
as
select member_id, split_part(bill_id, '-', 1)::integer as congress, count(*)::integer as cosponsored
  from public.bill_cosponsors
 where withdrawn_date is null
 group by member_id, split_part(bill_id, '-', 1);

grant select on public.member_cosponsor_counts to anon, authenticated;
