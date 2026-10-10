-- Discussions (and requests for one) can be about a governor's executive order or a
-- state high court decision. Target ids carry the state: 'ma-635' (order No. 635),
-- 'ma-10123456' (CourtListener cluster id).

alter table public.discussions drop constraint discussions_target_type_check;
alter table public.discussions add constraint discussions_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project',
                  'state_order', 'state_court_case')
);

alter table public.discussion_requests drop constraint discussion_requests_target_type_check;
alter table public.discussion_requests add constraint discussion_requests_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project',
                  'state_order', 'state_court_case')
);

alter table public.discussion_requests_anon drop constraint discussion_requests_anon_target_type_check;
alter table public.discussion_requests_anon add constraint discussion_requests_anon_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case', 'capital_project',
                  'state_order', 'state_court_case')
);

alter table public.feed_events drop constraint feed_events_target_type_check;
alter table public.feed_events add constraint feed_events_target_type_check check (
  target_type in (
    'bill', 'member', 'state_bill', 'state_legislator', 'local_matter', 'local_official', 'discussion',
    'executive_order', 'scotus_case', 'capital_project', 'state_order', 'state_court_case')
);
