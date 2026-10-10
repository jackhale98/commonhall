/**
 * Daily (pg_cron): Middletown, Connecticut's 311 report from SeeClickFix's public
 * API (no key). Only the report is stored, never an issue.
 */
import { SeeClickFixClient } from '@civic/congress-client';
import { MIDDLETOWN_311_JOB, runJob, syncMiddletown311 } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-middletown-311', ({ sql, log }) =>
  runJob({
    sql,
    job: MIDDLETOWN_311_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncMiddletown311(ctx, { client: new SeeClickFixClient() }),
  }),
);
