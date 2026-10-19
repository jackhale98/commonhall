-- Res Publica's import of landmark cases is done, so CommonHall's CourtListener jobs go
-- back to their usual schedules and share of the token (docs/decisions.md §124, undoing
-- the reduction in migration 072).
--
-- sync-scotus: hourly again; sync-state-courts: every 3 hours. Their request caps
-- (packages/sync/src/job.ts) return to 110 a day (60 and 50, no more than 45 an hour).
-- The health check's expected intervals change back to match. No rows rewritten; the
-- jobs may catch up on decisions filed since the reduction, within those caps.

select cron.schedule('sync-scotus', '20 * * * *', $$select private.invoke_sync('sync-scotus')$$);
select cron.schedule('sync-state-courts', '50 */3 * * *', $$select private.invoke_sync('sync-state-courts')$$);

update private.job_schedule set every = '1 hour' where job = 'scotus';
update private.job_schedule set every = '3 hours' where job = 'state-courts';
