/**
 * Nightly (pg_cron, several short runs): Open States bills for each state's
 * current session, plus legislators weekly. Spends at most
 * OPENSTATES_DAILY_BUDGET requests per UTC day (default 450) and spaces them
 * OPENSTATES_MIN_INTERVAL_MS apart (default 1100 ms).
 */
import { OpenStatesClient } from '@civic/congress-client';
import { OPENSTATES_API, STATE_JOB, dailyBudget, runJob, syncStates, type StateCursor } from '@civic/sync';
import { env, envNumber, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-state', async ({ sql, log }) => {
  const budget = await dailyBudget(sql, OPENSTATES_API, envNumber('OPENSTATES_DAILY_BUDGET', 450), 200);
  if (budget.limit <= 0) return { skipped: 'daily Open States budget used' };
  const client = new OpenStatesClient({
    apiKey: env('OPENSTATES_API_KEY'),
    budget,
    minIntervalMs: envNumber('OPENSTATES_MIN_INTERVAL_MS', 1100),
    maxAttempts: 3,
  });
  return runJob<StateCursor>({
    sql,
    job: STATE_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { [OPENSTATES_API]: budget },
    log,
    run: (ctx) => syncStates(ctx, { client }),
  });
});
