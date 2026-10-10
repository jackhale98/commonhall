/**
 * Every 15 minutes (pg_cron): Somerville City Council matters, actions, sponsors, and
 * council and committee meetings from Legistar; councilors weekly, with seats from
 * their office record titles (no seat map).
 */
import { LegistarClient } from '@civic/congress-client';
import { SOMERVILLE, SOMERVILLE_JOB, runJob, syncLegistarCity, type BostonCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-somerville', ({ sql, log }) =>
  runJob<BostonCursor>({
    sql,
    job: SOMERVILLE_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) =>
      syncLegistarCity(ctx, {
        client: new LegistarClient({ client: SOMERVILLE.legistar, delayMs: 100 }),
        city: SOMERVILLE,
      }),
  }),
);
