-- State bill search (review item 13; docs/decisions.md §109). The Bills tab searches a
-- state's bills by title or number with a substring match (ilike '%term%'), which read
-- every bill of the state. Trigram indexes let Postgres find the matches instead. About
-- 30,000 bills in October 2026: a few MB of index (titles average about 120
-- characters); state bills are kept for the current session only, so it stays bounded.
--
-- No upstream requests.

create index if not exists state_bills_title_trgm_idx on public.state_bills using gin (title extensions.gin_trgm_ops);
create index if not exists state_bills_identifier_trgm_idx
  on public.state_bills using gin (identifier extensions.gin_trgm_ops);
