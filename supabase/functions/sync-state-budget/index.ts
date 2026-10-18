/**
 * Daily (pg_cron): state budgets, line by line, with spending so far. Massachusetts
 * from the Comptroller's CTHRU portal (no key), read only when it has changed.
 */
import { SocrataClient } from '@civic/congress-client';
import { MA_BUDGET_DOMAIN, STATE_BUDGET_JOB, runJob, syncStateBudgets, type StateBudgetCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-state-budget', async ({ sql, log }) =>
  runJob<StateBudgetCursor>({
    sql,
    job: STATE_BUDGET_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncStateBudgets(ctx, { ma: new SocrataClient(MA_BUDGET_DOMAIN) }),
  }),
);
