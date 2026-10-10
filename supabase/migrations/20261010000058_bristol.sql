-- Bristol, Connecticut: the City Council, its joint meetings with the Board of
-- Finance and its Ordinance, Real Estate and Salary Committees from CivicClerk
-- (bristolct.api.civicclerk.com, public, no key), hourly; the mayor and councilors
-- from the city's website, weekly. Agenda items are council matters
-- ("ct-bristol-202602402" for item 2026-2402). Council districts aren't published as
-- shapes, so "Load council districts" loads the city's whole boundary (district 0):
-- an address in Bristol finds the whole council.

select cron.schedule('sync-bristol', '41 * * * *', $$select private.invoke_sync('sync-bristol')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('bristol', 'Bristol City Council meetings', '1 hour', 'sync-bristol')
on conflict (job) do nothing;
