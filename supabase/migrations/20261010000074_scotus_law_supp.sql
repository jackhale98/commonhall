-- The legal provision the Court considered in each case, from the Supreme Court
-- Database (SCDB lawSupp), so a decision's page can link the clause of the Constitution
-- it turned on to its text on Res Publica (docs/decisions.md §125). Codes 100–153 are
-- the Constitution's articles, 200–241 its amendments, 300 and above statutes and
-- rules; the labels and Res Publica refs live in the site (site/src/lib/respublica.ts).
--
-- No rows rewritten and no upstream requests here: scripts/load-scdb.ts replaces every
-- row from the newest release, one download, on its next monthly run or when run by
-- hand.

alter table public.scotus_outcomes add column law_supp smallint;

comment on column public.scotus_outcomes.law_supp is
  'SCDB lawSupp: the legal provision the Court considered (100–153 the Constitution''s articles, 200–241 amendments, 300+ statutes).';
