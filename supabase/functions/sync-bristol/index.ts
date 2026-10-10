/**
 * Hourly (pg_cron): Bristol, Connecticut's City Council and committee meetings and
 * agenda items from CivicClerk; the mayor and councilors from the city's website weekly.
 */
import { CivicClerkClient } from '@civic/congress-client';
import { BRISTOL_JOB, bristolPageFetcher, runJob, syncBristol, type BristolCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-bristol', ({ sql, log }) =>
  runJob<BristolCursor>({
    sql,
    job: BRISTOL_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncBristol(ctx, { civicclerk: new CivicClerkClient(), fetchPage: bristolPageFetcher() }),
  }),
);
