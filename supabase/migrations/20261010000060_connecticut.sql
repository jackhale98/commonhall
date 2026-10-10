-- Connecticut in depth (docs/decisions.md §101): bill histories, floor roll calls and
-- summaries (sync-state, FIRST_CLASS_STATES), the Supreme Court (sync-state-courts,
-- court id conn) and the governor's executive orders (the "Load CT governor orders"
-- workflow).
--
-- Governors' orders get a label. Massachusetts numbers its orders (No. 635);
-- Connecticut's are "26-3" (the third of 2026), and Governor Lamont's earlier ones
-- "7OOO" or "14F". `label` is what an order is called, shown on the site and used in its
-- page address and discussion id (lower-cased: ct-26-3, ma-635). `number` stays the
-- integer key and sorts within a state (202603 for 26-3, 767 for 7OOO); for
-- Massachusetts the two are the same.

alter table public.state_executive_orders add column label text;
update public.state_executive_orders set label = number::text where label is null;
alter table public.state_executive_orders alter column label set not null;
create unique index state_executive_orders_label_idx on public.state_executive_orders (state, lower(label));
comment on column public.state_executive_orders.label is
  'What the state calls the order ("635", "26-3", "7OOO"); lower-cased in its page address and discussion id.';
comment on column public.state_executive_orders.number is
  'Integer key, sortable within a state: the order number in Massachusetts; 202603 for Connecticut''s 26-3.';

-- Prerendered bill pages: Connecticut bills that passed a chamber or became law (a few
-- hundred a session), like Massachusetts bills that moved. Other bills open from the
-- shared fallback page, read live.
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
    or exists (select 1 from public.followed_targets f where f.target_type = 'state_bill' and f.target_id = s.id);

insert into private.job_schedule (job, label, every, runner) values
  ('load-ct-orders', 'Connecticut governor''s orders', '7 days', 'workflow: Load CT governor orders')
on conflict (job) do nothing;

-- Freshness: as migration 055, except governors' orders. Connecticut's governor issues
-- one to three a year, so a state with fewer than eight orders in the last two years may
-- go 450 days without one before it is flagged; Massachusetts (about ten a year) keeps
-- 180 days. Courts and states are still covered per court and per state.
create or replace function private.data_freshness()
returns table (name text, label text, newest date, max_age interval)
language sql
stable
security definer
set search_path = ''
as $$
  select 'bills', 'Bills in Congress', max(update_date)::date, interval '7 days' from public.bills
  union all
  select 'state-bills', 'State bills', max(updated_at)::date, interval '7 days' from public.state_bills
  union all
  select 'executive-orders', 'Presidential documents', max(publication_date), interval '90 days'
    from public.executive_orders
  union all
  select 'scotus', 'Supreme Court decisions', max(date_filed), interval '150 days' from public.scotus_cases
  union all
  select 'court:' || court_id, 'Decisions: ' || court_id, max(date_filed), interval '45 days'
    from public.state_court_cases group by court_id
  union all
  select 'governor:' || state, 'Governor''s orders: ' || state, max(signed_date),
    case when count(*) filter (where signed_date >= current_date - 730) >= 8 then interval '180 days'
         else interval '450 days' end
    from public.state_executive_orders group by state
  union all
  select 'matters:' || city, 'Council items: ' || city, max(coalesce(agenda_date, intro_date)), interval '45 days'
    from public.local_matters group by city
  union all
  select 'meetings:' || city, 'Council meetings: ' || city, max(date), interval '45 days'
    from public.local_meetings where date <= current_date group by city
  union all
  select '311:' || city, '311 requests: ' || city, (report->>'to')::date, interval '4 days'
    from public.city_311_reports
  union all
  select 'zba', 'Boston zoning appeals', max(received_date), interval '30 days' from public.zba_appeals;
$$;

revoke all on function private.data_freshness() from public, anon, authenticated;
