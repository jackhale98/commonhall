/**
 * Weekly (pg_cron): Boston's five-year Capital Plan from Analyze Boston (no key).
 * Reads the city's table only when it has changed since the last run.
 */
import { AnalyzeBostonClient } from '@civic/congress-client';
import { CAPITAL_PLAN_JOB, runJob, syncCapitalPlan, type CapitalPlanCursor } from '@civic/sync';
import { serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-capital-plan', async ({ sql, log }) =>
  runJob<CapitalPlanCursor>({
    sql,
    job: CAPITAL_PLAN_JOB,
    timeLimitMs: timeLimitMs(),
    log,
    run: (ctx) => syncCapitalPlan(ctx, { client: new AnalyzeBostonClient() }),
  }),
);
