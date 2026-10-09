/**
 * Daily (pg_cron): Boston Zoning Board of Appeal cases from Analyze Boston (no
 * key) — open appeals and those heard in the last year.
 */
import { AnalyzeBostonClient } from '@civic/congress-client';
import { ZBA_JOB, runJob, syncZoningAppeals, type ZbaCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-boston-zba', async ({ sql, log }) =>
  runJob<ZbaCursor>({
    sql,
    job: ZBA_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncZoningAppeals(ctx, { client: new AnalyzeBostonClient() }),
  }),
);
