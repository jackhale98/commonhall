-- Who wrote what in each Supreme Court decision (docs/decisions.md §104). CourtListener
-- keeps recent decisions as one combined document, so its concurrence and dissent
-- counts are zero; the opinion text the scotus sync already reads names them. Read
-- once per case (newest first, from the shared CourtListener budget).

alter table public.scotus_cases
  -- [{"author": "Thomas", "kind": "dissenting", "joined": ["Gorsuch"]}], from each
  -- separate opinion's heading.
  add column separate_opinions jsonb,
  -- The Reporter's lineup at the end of the syllabus, word for word ("Roberts, C. J.,
  -- delivered the opinion of the Court, in which …"); null for orders without one.
  add column opinion_lineup text,
  add column opinions_checked_at timestamptz;

comment on column public.scotus_cases.separate_opinions is
  'Concurring and dissenting opinions named in the opinion text: author, kind, who joined.';
comment on column public.scotus_cases.opinion_lineup is
  'The syllabus lineup (who delivered the opinion, who joined, who wrote separately), word for word.';
