/**
 * Every 30 minutes (pg_cron): Cambridge City Council meetings, items, sponsors and
 * roll calls from PrimeGov (since January 2026), the IQM2 archive (2025, loaded
 * once, a little each run) and councillors from IQM2 weekly.
 */
import { Iqm2Client, PrimeGovClient } from '@civic/congress-client';
import { CAMBRIDGE_JOB, runJob, syncCambridge, type CambridgeCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-cambridge', ({ sql, log }) =>
  runJob<CambridgeCursor>({
    sql,
    job: CAMBRIDGE_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) =>
      syncCambridge(ctx, {
        // About one request a second to each city portal.
        iqm2: new Iqm2Client({ client: 'cambridgema', minIntervalMs: 800 }),
        primegov: new PrimeGovClient({ client: 'cambridgema', minIntervalMs: 800 }),
      }),
  }),
);
