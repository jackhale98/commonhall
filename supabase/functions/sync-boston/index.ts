/**
 * Nightly (pg_cron, a few short runs): Boston City Council matters, actions,
 * sponsors, meetings and any recorded roll calls from Legistar; councilors weekly.
 */
import { LegistarClient } from '@civic/congress-client';
import { BOSTON_JOB, runJob, syncBoston, type BostonCursor } from '@civic/sync';
import seats from '../../data/boston-council-seats.json' with { type: 'json' };
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-boston', ({ sql, log }) =>
  runJob<BostonCursor>({
    sql,
    job: BOSTON_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncBoston(ctx, { client: new LegistarClient({ delayMs: 100 }), seats }),
  }),
);
