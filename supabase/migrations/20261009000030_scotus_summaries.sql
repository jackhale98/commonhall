-- Supreme Court case summaries, neutral and from official sources:
-- 1. scotus_cases.syllabus_text: the background part of the Court's syllabus (by the
--    Reporter of Decisions), read once from the opinion text on CourtListener.
--    opinion_ids lets the sync fetch that text; syllabus_checked_at stops re-reading.
-- 2. scotus_outcomes.issue_area / issue: the Supreme Court Database's topic codes
--    (labels in the site, from SCDB's codebook). Filled when the SCDB loader next runs.

alter table public.scotus_cases
  add column opinion_ids integer[] not null default '{}',
  add column syllabus_text text,
  add column syllabus_checked_at timestamptz;

comment on column public.scotus_cases.syllabus_text is
  'Background part of the official syllabus (Reporter of Decisions), word for word; null when there is none.';

alter table public.scotus_outcomes
  add column issue integer,
  add column issue_area smallint;

comment on column public.scotus_outcomes.issue_area is 'SCDB issueArea (1–14), e.g. 1 Criminal Procedure.';
comment on column public.scotus_outcomes.issue is 'SCDB issue code, e.g. 10050 search and seizure.';

-- Re-read every month once so existing cases get their opinion ids.
update public.sync_state set cursor = cursor - 'filledThrough' where job = 'scotus';
