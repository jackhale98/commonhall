/** Daily (pg_cron): refresh `members` from Congress.gov and congress-legislators. */
import { CongressClient, LegislatorsClient, congressForDate } from '@civic/congress-client';
import { hourlyBudget, runJob, syncMembers } from '@civic/sync';
import { env, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-members', async ({ sql, log }) => {
  const congress = congressForDate(new Date());
  const budget = await hourlyBudget(sql, 'congress', 50);
  const client = new CongressClient({ apiKey: env('CONGRESS_API_KEY'), budget });
  const legislators = new LegislatorsClient();

  return runJob({
    sql,
    job: 'federal-members',
    timeLimitMs: timeLimitMs(),
    budgets: { congress: budget },
    log,
    run: async (ctx) => {
      const result = await syncMembers(sql, { congress, client, legislators });
      ctx.rowsWritten += result.rowsWritten;
      return { congress, members: result.members };
    },
  });
});
