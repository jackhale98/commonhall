/**
 * Weekly (pg_cron): Boston's operating and revenue budgets from Analyze Boston (no
 * key). Reads each file only when the city has changed it.
 */
import { AnalyzeBostonClient } from '@civic/congress-client';
import { CITY_BUDGET_JOB, runJob, syncCityBudget, type CityBudgetCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-city-budget', async ({ sql, log }) =>
  runJob<CityBudgetCursor>({
    sql,
    job: CITY_BUDGET_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncCityBudget(ctx, { client: new AnalyzeBostonClient() }),
  }),
);
