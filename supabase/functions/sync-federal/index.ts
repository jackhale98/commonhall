/**
 * Every 10 minutes (pg_cron): bills changed since the last cursor, writing a
 * feed event for each new action, cosponsor and bill. Each run is time-boxed and
 * capped so six runs stay within ~3,500 Congress.gov requests an hour, leaving
 * headroom for on-demand fetches.
 */
import { CongressClient, congressForDate } from '@civic/congress-client';
import {
  BILLS_JOB,
  billEvents,
  hourlyBudget,
  runJob,
  syncBillsIncremental,
  writeFeedEvents,
  type BillsCursor,
} from '@civic/sync';
import { env, envNumber, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-federal', async ({ sql, log }) => {
  const congress = congressForDate(new Date());
  const budget = await hourlyBudget(sql, 'congress', envNumber('SYNC_FEDERAL_RUN_CAP', 580));
  const client = new CongressClient({ apiKey: env('CONGRESS_API_KEY'), budget });
  const limit = timeLimitMs();

  const bills = await runJob<BillsCursor>({
    sql,
    job: BILLS_JOB,
    timeLimitMs: limit,
    budgets: { congress: budget },
    log,
    run: async (ctx) =>
      (
        await syncBillsIncremental(ctx, {
          congress,
          client,
          concurrency: envNumber('SYNC_CONCURRENCY', 3),
          onChange: (change) => writeFeedEvents(sql, billEvents(change)),
        })
      ).cursor,
  });

  return { congress, bills };
});
