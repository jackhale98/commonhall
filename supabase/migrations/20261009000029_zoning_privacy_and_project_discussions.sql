-- 1. Zoning appeals: only upcoming hearings are kept with an address (residents can
--    testify at them). Decided cases are no longer stored one by one; the last
--    year's outcomes are kept as counts per neighborhood (zba_decision_counts).
-- 2. Discussions (and requests for one) can be about a Capital Plan project
--    (target id: the city's project id).

delete from public.zba_appeals where hearing_date is null or hearing_date < current_date;
comment on table public.zba_appeals is
  'Boston Zoning Board of Appeal cases with a hearing still to come (no applicant names; removed once heard).';

create table public.zba_decision_counts (
  neighborhood text not null,
  /** Approved, Approved with provisos, Denied, Withdrawn, … */
  decision text not null,
  cases integer not null,
  updated_at timestamptz not null default now(),
  primary key (neighborhood, decision)
);

comment on table public.zba_decision_counts is
  'Zoning Board of Appeal decisions in the last year, counted per neighborhood and outcome (no addresses).';

alter table public.zba_decision_counts enable row level security;
create policy "Public read" on public.zba_decision_counts for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.zba_decision_counts from anon, authenticated;

alter table public.discussions drop constraint discussions_target_type_check;
alter table public.discussions add constraint discussions_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project')
);

alter table public.discussion_requests drop constraint discussion_requests_target_type_check;
alter table public.discussion_requests add constraint discussion_requests_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project')
);

alter table public.discussion_requests_anon drop constraint discussion_requests_anon_target_type_check;
alter table public.discussion_requests_anon add constraint discussion_requests_anon_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project')
);

alter table public.feed_events drop constraint feed_events_target_type_check;
alter table public.feed_events add constraint feed_events_target_type_check check (
  target_type in (
    'bill', 'member', 'state_bill', 'state_legislator', 'local_matter', 'local_official', 'discussion',
    'executive_order', 'scotus_case', 'capital_project')
);
