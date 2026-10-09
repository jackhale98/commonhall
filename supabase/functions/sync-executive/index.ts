/**
 * Hourly (pg_cron): executive orders from the Federal Register (no key) and
 * presidential nominations from Congress.gov, both incremental after the first run.
 */
import { CongressClient, FederalRegisterClient, congressForDate } from '@civic/congress-client';
import { EXECUTIVE_JOB, hourlyBudget, runJob, syncExecutive, type ExecutiveCursor } from '@civic/sync';
import { env, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-executive', async ({ sql, log }) => {
  const budget = await hourlyBudget(sql, 'congress', 40);
  return runJob<ExecutiveCursor>({
    sql,
    job: EXECUTIVE_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { congress: budget },
    log,
    run: (ctx) =>
      syncExecutive(ctx, {
        federalRegister: new FederalRegisterClient(),
        congress: new CongressClient({ apiKey: env('CONGRESS_API_KEY'), budget }),
        congressNumber: congressForDate(new Date()),
      }),
  });
});
