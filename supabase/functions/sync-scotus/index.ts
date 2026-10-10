/** Hourly (pg_cron): Supreme Court decisions from CourtListener (needs COURTLISTENER_TOKEN). */
import { CourtListenerClient } from '@civic/congress-client';
import { COURTLISTENER_API, SCOTUS_JOB, hourlyBudget, runJob, syncSupremeCourt, type ScotusCursor } from '@civic/sync';
import { env, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-scotus', async ({ sql, log }) => {
  const budget = await hourlyBudget(sql, COURTLISTENER_API, 10);
  return runJob<ScotusCursor>({
    sql,
    job: SCOTUS_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { [COURTLISTENER_API]: budget },
    log,
    run: (ctx) =>
      syncSupremeCourt(ctx, {
        // CourtListener allows 5 requests a minute: space them out, and wait out a short Retry-After.
        client: new CourtListenerClient({
          token: env('COURTLISTENER_TOKEN'),
          budget,
          minIntervalMs: 13_000,
          maxRetryAfterMs: 65_000,
        }),
      }),
  });
});
