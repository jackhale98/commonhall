-- CommonHall's CourtListener jobs run less often and take a smaller part of the API's
-- allowance, so Res Publica, which uses the same token (CourtListener allows one per
-- person), has the rest for its import of landmark cases (docs/decisions.md §121).
--
-- sync-scotus: every 6 hours instead of hourly; sync-state-courts: daily instead of every
-- 3 hours. Their request caps (packages/sync/src/job.ts) fall from 110 a day to 20
-- (12 and 8). The health check's expected intervals change to match, so neither job is
-- reported overdue. No rows rewritten, no upstream requests.

select cron.schedule('sync-scotus', '20 */6 * * *', $$select private.invoke_sync('sync-scotus')$$);
select cron.schedule('sync-state-courts', '50 7 * * *', $$select private.invoke_sync('sync-state-courts')$$);

update private.job_schedule set every = '6 hours' where job = 'scotus';
update private.job_schedule set every = '1 day' where job = 'state-courts';
