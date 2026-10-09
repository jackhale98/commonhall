-- Supreme Court outcomes from the Supreme Court Database (scdb.la.psu.edu), loaded
-- by scripts/load-scdb.ts (a monthly GitHub Action; the database publishes about
-- once a year). Matched to CourtListener decisions by term and docket number.

create table public.scotus_outcomes (
  /** SCDB caseId, e.g. 2025-068. */
  scdb_case_id text primary key,
  term smallint not null,
  docket text,
  us_cite text,
  case_name text not null,
  date_decision date,
  /** SCDB partyWinning: 1 the petitioner won, 0 the respondent won, 2 unclear. */
  party_winning smallint,
  /** SCDB caseDisposition: 2 affirmed, 3 reversed, 4 reversed and remanded, 5 vacated and remanded, … */
  case_disposition smallint,
  /** SCDB decisionType: 1 signed opinion after argument, 2 per curiam without argument, … */
  decision_type smallint,
  maj_votes smallint,
  min_votes smallint,
  /** The release the row came from, e.g. 2026_01. */
  release text not null,
  loaded_at timestamptz not null default now()
);

comment on table public.scotus_outcomes is 'Supreme Court Database case outcomes (who won, disposition, vote split), from 2009.';
create index scotus_outcomes_term_idx on public.scotus_outcomes (term);

alter table public.scotus_outcomes enable row level security;
create policy "Public read" on public.scotus_outcomes for select to anon, authenticated using (true);
revoke insert, update, delete, truncate on public.scotus_outcomes from anon, authenticated;

-- CourtListener sometimes publishes a corrected opinion as a second cluster named
-- "<case> Revisions: 7/01/26". The sync marks those, strips the suffix and drops
-- them once the original decision is stored.
alter table public.scotus_cases add column revision boolean not null default false;
comment on column public.scotus_cases.revision is 'A CourtListener "Revisions" cluster: kept only when the original decision is missing.';

update public.scotus_cases
   set revision = true,
       case_name = regexp_replace(case_name, '\s+Revisions?:.*$', '')
 where case_name ~ '\s+Revisions?:';

delete from public.scotus_cases r
 where r.revision
   and exists (
     select 1 from public.scotus_cases o
      where not o.revision and o.term = r.term and o.docket_number = r.docket_number
   );
