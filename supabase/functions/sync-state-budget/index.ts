/**
 * Daily (pg_cron): state budgets, line by line, with spending so far, and Connecticut's
 * town budgets. Massachusetts from the Comptroller's CTHRU portal, Connecticut from
 * data.ct.gov (no keys), each read only when it has changed.
 */
import { SocrataClient } from '@civic/congress-client';
import {
  CT_BUDGET_DOMAIN,
  MA_BUDGET_DOMAIN,
  STATE_BUDGET_JOB,
  runJob,
  syncStateBudgets,
  type StateBudgetCursor,
} from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-state-budget', async ({ sql, log }) =>
  runJob<StateBudgetCursor>({
    sql,
    job: STATE_BUDGET_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) =>
      syncStateBudgets(ctx, { ma: new SocrataClient(MA_BUDGET_DOMAIN), ct: new SocrataClient(CT_BUDGET_DOMAIN) }),
  }),
);
