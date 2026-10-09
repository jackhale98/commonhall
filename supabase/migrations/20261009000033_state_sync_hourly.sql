-- Run sync-state every hour (at :07) instead of ten times between 06:00 and 10:30 UTC.
-- The Open States daily budget resets at midnight UTC, so the 00:07 run starts the new
-- day's requests about six hours sooner, and hourly catch-ups keep first-class states
-- fresher during the day. Runs after the day's budget is spent stop at once.
select cron.schedule('sync-state', '7 * * * *', $$select private.invoke_sync('sync-state')$$);
