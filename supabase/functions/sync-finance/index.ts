/**
 * Hourly (pg_cron): refresh campaign finance summaries from OpenFEC for members
 * whose row is missing or older than a week, within an hourly request budget.
 * FEC_API_KEY falls back to CONGRESS_API_KEY (both are api.data.gov keys).
 */
import { FecClient } from '@civic/congress-client';
import { FEC_API, FINANCE_JOB, hourlyBudget, runJob, syncFinance, type FinanceCursor } from '@civic/sync';
import { env, envNumber, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-finance', async ({ sql, log }) => {
  const budget = await hourlyBudget(sql, FEC_API, envNumber('FEC_HOURLY_CAP', 300));
  const apiKey = Deno.env.get('FEC_API_KEY') || env('CONGRESS_API_KEY');
  return runJob<FinanceCursor>({
    sql,
    job: FINANCE_JOB,
    timeLimitMs: timeLimitMs(),
    budgets: { [FEC_API]: budget },
    log,
    run: (ctx) => syncFinance(ctx, { client: new FecClient({ apiKey, budget }) }),
  });
});
