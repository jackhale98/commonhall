/** Every three hours (pg_cron): state high court decisions from CourtListener (needs COURTLISTENER_TOKEN). */
import { CourtListenerClient } from '@civic/congress-client';
import {
  COURTLISTENER_API,
  STATE_COURTS_JOB,
  hourlyBudget,
  runJob,
  syncStateCourts,
  type StateCourtsCursor,
} from '@civic/sync';
import { env, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-state-courts', async ({ sql, log }) => {
  // A few requests a run: the free tier (50 an hour, 125 a day) is shared with sync-scotus,
  // and hourlyBudget holds this run to what is left of both.
  const budget = await hourlyBudget(sql, COURTLISTENER_API, 8);
  return runJob<StateCourtsCursor>({
    sql,
    job: STATE_COURTS_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { [COURTLISTENER_API]: budget },
    log,
    run: (ctx) =>
      syncStateCourts(ctx, {
        client: new CourtListenerClient({
          token: env('COURTLISTENER_TOKEN'),
          budget,
          minIntervalMs: 13_000,
          maxRetryAfterMs: 65_000,
        }),
      }),
  });
});
