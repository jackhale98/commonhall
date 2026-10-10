/**
 * Daily (pg_cron): Cambridge's 311 report, operating and revenue budgets and
 * capital plan from the city's open data portal (data.cambridgema.gov, no key).
 */
import { SocrataClient } from '@civic/congress-client';
import { CAMBRIDGE_DATA_DOMAIN, CAMBRIDGE_DATA_JOB, runJob, syncCambridgeData } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-cambridge-data', ({ sql, log }) =>
  runJob({
    sql,
    job: CAMBRIDGE_DATA_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncCambridgeData(ctx, { client: new SocrataClient(CAMBRIDGE_DATA_DOMAIN) }),
  }),
);
