-- public.data_status() (the Data status page, and the freshness note on every data
-- section, which visitors' browsers now call) finds the newest state bill with
-- max(updated_at), which read all of state_bills (74,000 rows with their text). From a
-- cold cache that took over 3 seconds, anon's statement timeout, and the call failed
-- with "canceling statement due to statement timeout" (docs/decisions.md §129). With
-- this index the newest row is read from the index alone. No rows rewritten, no
-- upstream requests; the index is about 2 MB.

create index if not exists state_bills_updated_at_idx on public.state_bills (updated_at desc);
