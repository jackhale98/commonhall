/**
 * Daily (pg_cron): Boston 311 request counts per day, district and type from
 * Analyze Boston (no key), from both of the city's 311 systems.
 */
import { AnalyzeBostonClient } from '@civic/congress-client';
import { BOSTON_311_JOB, runJob, syncBoston311, type Boston311Cursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-boston-311', async ({ sql, log }) =>
  runJob<Boston311Cursor>({
    sql,
    job: BOSTON_311_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncBoston311(ctx, { client: new AnalyzeBostonClient() }),
  }),
);
