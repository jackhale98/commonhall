-- Statewide ballot questions (docs/decisions.md §103), with the state's own write-up:
-- for Massachusetts, the Secretary of the Commonwealth's "Information for Voters"
-- guide (the "Load MA ballot questions" workflow). Each question keeps every section
-- of the guide as the state wrote it: the summary, what a yes and a no vote do, the
-- fiscal consequences, the arguments for and against (each written by its side), the
-- Legislature's committee reports and the full text. Paragraphs are plain text.
-- Connecticut's referred amendments (explanatory text from the Office of Legislative
-- Research) fit the same columns when one is on the ballot.

create table public.ballot_questions (
  state text not null,
  election_date date not null,
  number smallint not null,
  kind text not null,
  title text not null,
  question text,
  summary text[] not null default '{}',
  yes_vote text,
  no_vote text,
  fiscal text[] not null default '{}',
  -- {"text": [paragraphs], "authors": [lines]}
  argument_for jsonb,
  argument_against jsonb,
  -- [{"title": "Majority Report", "text": [paragraphs]}]
  reports jsonb not null default '[]',
  full_text text[] not null default '{}',
  -- Who wrote each section, as the guide says it ({"summary": "As required by law, …"}).
  notes jsonb not null default '{}',
  source_url text not null,
  -- Filled once the result is certified.
  yes_count integer,
  no_count integer,
  updated_at timestamptz not null default now(),
  primary key (state, election_date, number)
);

comment on table public.ballot_questions is
  'Statewide ballot questions with the state''s official write-up (Massachusetts: Information for Voters).';

alter table public.ballot_questions enable row level security;
create policy "Public read" on public.ballot_questions for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.ballot_questions from anon, authenticated;
grant select on public.ballot_questions to anon, authenticated;

insert into private.job_schedule (job, label, every, runner) values
  ('load-ma-ballot', 'Massachusetts ballot questions', '7 days', 'workflow: Load MA ballot questions')
on conflict (job) do nothing;
