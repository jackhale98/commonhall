/**
 * Daily (pg_cron): federal spending. The Monthly Treasury Statement's receipts and
 * outlays (Treasury Fiscal Data API, read when a new statement is out), each agency's
 * budget, and awards by state and congressional district (USAspending, weekly). No key.
 */
import { FiscalDataClient, RequestBudget, UsaSpendingClient } from '@civic/congress-client';
import { FEDERAL_BUDGET_JOB, runJob, syncFederalBudget, type FederalBudgetCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-federal-budget', async ({ sql, log }) =>
  runJob<FederalBudgetCursor>({
    sql,
    job: FEDERAL_BUDGET_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) =>
      syncFederalBudget(ctx, {
        treasury: new FiscalDataClient({ budget: new RequestBudget(10, 'Treasury Fiscal Data') }),
        usaspending: new UsaSpendingClient({ budget: new RequestBudget(20, 'USAspending'), timeoutMs: 45_000 }),
      }),
  }),
);
