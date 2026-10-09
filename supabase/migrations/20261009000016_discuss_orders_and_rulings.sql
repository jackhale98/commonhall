-- Discussions (and requests for one) can be about an executive order (target id:
-- Federal Register document number) or a Supreme Court decision (CourtListener
-- cluster id). Opening one writes a feed event with the same target type.

alter table public.discussions drop constraint discussions_target_type_check;
alter table public.discussions add constraint discussions_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case')
);

alter table public.discussion_requests drop constraint discussion_requests_target_type_check;
alter table public.discussion_requests add constraint discussion_requests_target_type_check check (
  target_type in ('bill', 'state_bill', 'local_matter', 'executive_order', 'scotus_case')
);

alter table public.feed_events drop constraint feed_events_target_type_check;
alter table public.feed_events add constraint feed_events_target_type_check check (
  target_type in (
    'bill', 'member', 'state_bill', 'state_legislator', 'local_matter', 'local_official', 'discussion',
    'executive_order', 'scotus_case')
);
