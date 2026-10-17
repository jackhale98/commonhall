-- State high court decisions: who wrote what, and openings read again
-- (docs/decisions.md §104). Slip opinions are double-spaced, so the opening read
-- before stopped at the first line ("This appeal involves the intersection of");
-- Connecticut's author line ("MULLINS, C. J.") wasn't recognized, and its decisions
-- could be read from a dissent. Every decision is read once more (newest first, from
-- the state-courts share of the CourtListener budget).

alter table public.state_court_cases
  -- [{"author": "Kafker", "kind": "concurring", "joined": ["Wendlandt"]}], from each
  -- separate opinion's heading in the court's text.
  add column separate_opinions jsonb;

comment on column public.state_court_cases.separate_opinions is
  'Concurring and dissenting opinions named in the opinion text: author, kind, who joined.';

update public.state_court_cases set text_checked_at = null;
