/**
 * Run a nightly job from Node without the Edge Function time limit, e.g. for the
 * first full Boston load (several thousand Legistar requests):
 *
 *   SUPABASE_DB_URL=… npx tsx scripts/run-job.ts boston [--minutes 60] [--since 2024-01-01]
 *   SUPABASE_DB_URL=… OPENSTATES_API_KEY=… npx tsx scripts/run-job.ts state [--minutes 60]
 *   SUPABASE_DB_URL=… npx tsx scripts/run-job.ts capital-plan | boston-zba | boston-311 | city-budget
 *   SUPABASE_DB_URL=… COURTLISTENER_TOKEN=… npx tsx scripts/run-job.ts state-courts
 *   SUPABASE_DB_URL=… npx tsx scripts/run-job.ts cambridge | cambridge-data
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import {
  AnalyzeBostonClient,
  CourtListenerClient,
  Iqm2Client,
  LegistarClient,
  OpenStatesClient,
  PrimeGovClient,
  SocrataClient,
} from '@civic/congress-client';
import {
  BOSTON_311_JOB,
  BOSTON_JOB,
  CAPITAL_PLAN_JOB,
  CITY_BUDGET_JOB,
  ZBA_JOB,
  OPENSTATES_API,
  STATE_COURTS_JOB,
  STATE_JOB,
  WORCESTER_JOB,
  CAMBRIDGE_DATA_DOMAIN,
  CAMBRIDGE_DATA_JOB,
  CAMBRIDGE_JOB,
  syncCambridge,
  syncCambridgeData,
  type CambridgeCursor,
  dailyBudget,
  runJob,
  syncBoston,
  syncCapitalPlan,
  syncCityBudget,
  syncBoston311,
  syncZoningAppeals,
  syncStateCourts,
  syncStates,
  syncWorcester,
  worcesterPageFetcher,
  type BostonCursor,
  type SeatMap,
  type Sql,
  type StateCourtsCursor,
  type StateCursor,
  type WorcesterCursor,
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
    if (job === 'worcester') {
      const result = await runJob<WorcesterCursor>({
        sql,
        job: WORCESTER_JOB,
        timeLimitMs,
        run: (ctx) => syncWorcester(ctx, { primegov: new PrimeGovClient(), fetchPage: worcesterPageFetcher() }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten, cursor: result.cursor }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'boston') {
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
    } else if (job === 'city-budget') {
      const result = await runJob({
        sql,
        job: CITY_BUDGET_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ?? ''),
        run: (ctx) => syncCityBudget(ctx, { client: new AnalyzeBostonClient() }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'boston-zba') {
      const result = await runJob({
        sql,
        job: ZBA_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ?? ''),
        run: (ctx) => syncZoningAppeals(ctx, { client: new AnalyzeBostonClient() }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'boston-311') {
      const result = await runJob({
        sql,
        job: BOSTON_311_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ?? ''),
        run: (ctx) => syncBoston311(ctx, { client: new AnalyzeBostonClient() }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'state-courts') {
      const token = process.env.COURTLISTENER_TOKEN;
      if (!token) throw new Error('Set COURTLISTENER_TOKEN');
      const result = await runJob<StateCourtsCursor>({
        sql,
        job: STATE_COURTS_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ?? ''),
        run: (ctx) => syncStateCourts(ctx, { client: new CourtListenerClient({ token, minIntervalMs: 13_000 }) }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'cambridge') {
      const result = await runJob<CambridgeCursor>({
        sql,
        job: CAMBRIDGE_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ? JSON.stringify(d) : ''),
        run: (ctx) =>
          syncCambridge(ctx, {
            iqm2: new Iqm2Client({ client: 'cambridgema', minIntervalMs: 800 }),
            primegov: new PrimeGovClient({ client: 'cambridgema', minIntervalMs: 800 }),
          }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else if (job === 'cambridge-data') {
      const result = await runJob({
        sql,
        job: CAMBRIDGE_DATA_JOB,
        timeLimitMs,
        log: (m, d) => console.log(m, d ? JSON.stringify(d) : ''),
        run: (ctx) => syncCambridgeData(ctx, { client: new SocrataClient(CAMBRIDGE_DATA_DOMAIN) }),
      });
      console.log(JSON.stringify({ status: result.status, rowsWritten: result.rowsWritten }));
      if (result.status === 'error') process.exit(1);
    } else {
      throw new Error(
        'Usage: run-job.ts <boston|worcester|cambridge|cambridge-data|state|state-courts|capital-plan|boston-zba|boston-311|city-budget> [--minutes N] [--since YYYY-MM-DD]',
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
