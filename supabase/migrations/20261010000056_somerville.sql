-- Somerville, Massachusetts (city key ma-somerville). No new tables: the council goes
-- into the shared local_* tables (Legistar, the same sync as Boston with Somerville's
-- settings) and 311 into city_311_reports, both keyed by city, so the freshness checks
-- in private.data_freshness() already cover it.
--
--   * sync-somerville: every 15 minutes, a few minutes off Boston's runs.
--   * sync-somerville-311: daily, 10:17 UTC (about 6 a.m. in Somerville), after the
--     portal's overnight refresh.

select cron.schedule('sync-somerville', '7,22,37,52 * * * *', $$select private.invoke_sync('sync-somerville')$$);
select cron.schedule('sync-somerville-311', '17 10 * * *', $$select private.invoke_sync('sync-somerville-311')$$);

insert into private.job_schedule (job, label, every, runner) values
  ('somerville', 'Somerville City Council', '15 minutes', 'sync-somerville'),
  ('somerville-311', 'Somerville 311 requests', '1 day', 'sync-somerville-311')
on conflict (job) do nothing;
