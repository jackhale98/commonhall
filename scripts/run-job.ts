/**
 * Run a nightly job from Node without the Edge Function time limit, e.g. for the
 * first full Boston load (several thousand Legistar requests):
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/run-job.ts boston [--minutes 60] [--since 2024-01-01]
 *   SUPABASE_DB_URL=… OPENSTATES_API_KEY=… npx tsx scripts/run-job.ts state [--minutes 60]
 *   SUPABASE_DB_URL=… npx tsx scripts/run-job.ts capital-plan
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { AnalyzeBostonClient, LegistarClient, OpenStatesClient } from '@civic/congress-client';
import {
  BOSTON_JOB,
  CAPITAL_PLAN_JOB,
  OPENSTATES_API,
  STATE_JOB,
  dailyBudget,
  runJob,
  syncBoston,
  syncCapitalPlan,
  syncStates,
  type BostonCursor,
  type SeatMap,
  type Sql,
  type StateCursor,
} from '@civic/sync';

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { minutes: { type: 'string', default: '60' }, since: { type: 'string' } },
  });
  const job = positionals[0];
  const url = process.env.SUPABASE_DB_URL;
  if (!url) throw new Error('Set SUPABASE_DB_URL');
  const sql = postgres(url, { max: 4, prepare: false, onnotice: () => undefined }) as unknown as Sql;
  const timeLimitMs = Number(values.minutes) * 60_000;
  try {
    if (job === 'boston') {
      const seats = JSON.parse(
        readFileSync(new URL('../supabase/data/boston-council-seats.json', import.meta.url), 'utf8'),
      ) as SeatMap;
      const result = await runJob<BostonCursor>({
        sql,
        job: BOSTON_JOB,
        timeLimitMs,
        run: (ctx) =>
          syncBoston(ctx, {
            client: new LegistarClient({ delayMs: 150 }),
            seats,
            startDate: values.since ? new Date(values.since).toISOString() : undefined,
          }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten, cursor: result.cursor }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'state') {
      const key = process.env.OPENSTATES_API_KEY;
      if (!key) throw new Error('Set OPENSTATES_API_KEY');
      const budget = await dailyBudget(sql, OPENSTATES_API, Number(process.env.OPENSTATES_DAILY_BUDGET ?? 450), 10_000);
      const client = new OpenStatesClient({ apiKey: key, budget, minIntervalMs: 1100 });
      const result = await runJob<StateCursor>({
        sql,
        job: STATE_JOB,
        timeLimitMs,
        budgets: { [OPENSTATES_API]: budget },
        run: (ctx) => syncStates(ctx, { client, pagesPerState: 1000 }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'capital-plan') {
      const result = await runJob({
        sql,
        job: CAPITAL_PLAN_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ?? ''),
        run: (ctx) => syncCapitalPlan(ctx, { client: new AnalyzeBostonClient() }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else {
      throw new Error('Usage: run-job.ts <boston|state|capital-plan> [--minutes N] [--since YYYY-MM-DD]');
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
