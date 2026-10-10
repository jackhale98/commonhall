-- What a state high court decision is about, read once from its opinion text:
-- the reporter's subject keywords ("Homicide. Evidence, Hearsay.") and the
-- opinion's opening paragraph. opinion_ids are CourtListener's, to fetch the text.

alter table public.state_court_cases
  add column opinion_ids bigint[] not null default '{}',
  add column keywords text,
  add column opening text,
  add column text_checked_at timestamptz;

create index state_court_cases_text_due_idx on public.state_court_cases (date_filed desc) where text_checked_at is null;
