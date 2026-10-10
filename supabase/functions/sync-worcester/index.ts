/**
 * Hourly (pg_cron): Worcester City Council and standing committee meetings from
 * PrimeGov; councilors and committee members from the city's website weekly.
 */
import { PrimeGovClient } from '@civic/congress-client';
import { WORCESTER_JOB, runJob, syncWorcester, worcesterPageFetcher, type WorcesterCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-worcester', ({ sql, log }) =>
  runJob<WorcesterCursor>({
    sql,
    job: WORCESTER_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncWorcester(ctx, { primegov: new PrimeGovClient(), fetchPage: worcesterPageFetcher() }),
  }),
);
