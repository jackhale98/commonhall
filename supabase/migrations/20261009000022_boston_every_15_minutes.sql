-- Boston City Council: every 15 minutes instead of four times a night. The first
-- load (meetings, then about 3,000 matters at two requests each) finishes in a few
-- hours instead of weeks, and afterwards new matters and meetings appear within
-- 15 minutes. A quiet run costs two Legistar list requests (no key, no quota).
select cron.schedule('sync-boston', '*/15 * * * *', $$select private.invoke_sync('sync-boston')$$);
