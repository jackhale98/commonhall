/**
 * Hourly (pg_cron): committee rosters (daily, congress-legislators), hearings and
 * markups (Congress.gov), and a batch of older bills' committee referrals.
 */
import { CongressClient, LegislatorsClient, congressForDate } from '@civic/congress-client';
import { COMMITTEES_JOB, hourlyBudget, runJob, syncCommittees, type CommitteesCursor } from '@civic/sync';
import { env, envNumber, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-committees', async ({ sql, log }) => {
  const budget = await hourlyBudget(sql, 'congress', envNumber('COMMITTEES_RUN_CAP', 150));
  return runJob<CommitteesCursor>({
    sql,
    job: COMMITTEES_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { congress: budget },
    log,
    run: (ctx) =>
      syncCommittees(ctx, {
        legislators: new LegislatorsClient(),
        client: new CongressClient({ apiKey: env('CONGRESS_API_KEY'), budget }),
        congress: congressForDate(new Date()),
      }),
  });
});
