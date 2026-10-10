/**
 * Daily (pg_cron): Somerville 311 service request counts per day, ward and type from
 * the city's Socrata portal (no key), summarised on the portal's side; only the
 * finished report is stored.
 */
import { SocrataClient } from '@civic/congress-client';
import { SOMERVILLE_311_JOB, SOMERVILLE_PORTAL, runJob, syncSomerville311 } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-somerville-311', ({ sql, log }) =>
  runJob({
    sql,
    job: SOMERVILLE_311_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncSomerville311(ctx, { client: new SocrataClient(SOMERVILLE_PORTAL) }),
  }),
);
