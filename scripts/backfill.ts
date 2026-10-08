/**
 * Federal backfill (Node, run from GitHub Actions or locally):
 *
 *   SUPABASE_DB_URL=… CONGRESS_API_KEY=… npm run backfill -- [--congress 119] [--reset]
 *
 * Loads members and every bill of the Congress (plus whatever later phases add),
 * pausing whenever the shared hourly Congress.gov budget is used up and
 * resuming from its cursor in `sync_state`. Stops cleanly after
 * BACKFILL_MAX_HOURS (default 5.5, under the 6-hour Actions job limit); run it
 * again to continue. Prints `done=true|false` to $GITHUB_OUTPUT.
 */
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { CongressClient, LegislatorsClient, congressForDate } from '@civic/congress-client';
import { hourlyBudget, runBackfill, runJob, setCursor, type BackfillCursor, type Sql } from '@civic/sync';
import { backfillExtraSteps } from './backfill-steps.ts';

export const JOB = 'backfill-federal';
const HOURLY_CAP = 4500;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See .env.example.`);
    process.exit(2);
  }
  return value;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function msUntilNextHour(now = Date.now()): number {
  const next = new Date(now);
  next.setUTCMinutes(60, 30, 0); // 30 s past the hour, after the counter rolls over
  return next.getTime() - now;
}

async function main() {
  const { values } = parseArgs({
    options: {
      congress: { type: 'string' },
      reset: { type: 'boolean', default: false },
    },
  });
  const congress = Number(values.congress ?? process.env.BACKFILL_CONGRESS ?? congressForDate(new Date()));
  const maxHours = Number(process.env.BACKFILL_MAX_HOURS ?? 5.5);
  const deadline = Date.now() + maxHours * 3_600_000;
  const apiKey = required('CONGRESS_API_KEY');
  const sql = postgres(required('SUPABASE_DB_URL'), {
    max: 4,
    prepare: false,
    onnotice: () => undefined,
  }) as unknown as Sql;
  const legislators = new LegislatorsClient();

  if (values.reset) {
    await setCursor(sql, JOB, {});
    console.log('Backfill cursor reset.');
  }

  let done = false;
  try {
    while (Date.now() < deadline) {
      const budget = await hourlyBudget(sql, 'congress', HOURLY_CAP);
      if (budget.limit <= 0) {
        const wait = Math.min(msUntilNextHour(), deadline - Date.now());
        console.log(`Hourly budget used; sleeping ${Math.round(wait / 60000)} min`);
        if (wait <= 0) break;
        await sleep(wait);
        continue;
      }
      const client = new CongressClient({ apiKey, budget });
      const result = await runJob<BackfillCursor>({
        sql,
        job: JOB,
        timeLimitMs: Math.max(60_000, Math.min(deadline - Date.now(), msUntilNextHour() + 3_600_000)),
        budgets: { congress: budget },
        run: (ctx) =>
          runBackfill(ctx, {
            congress,
            client,
            legislators,
            extraSteps: backfillExtraSteps({ congress, client, legislators }),
          }),
      });
      console.log(
        JSON.stringify({
          status: result.status,
          step: result.cursor?.step,
          billsDone: result.cursor?.billsDone,
          requests: result.requests,
          rowsWritten: result.rowsWritten,
        }),
      );
      if (result.status === 'error') throw new Error(result.reason);
      if (result.status === 'skipped') throw new Error('Another backfill run holds the lock.');
      if (result.cursor?.step === 'done') {
        done = true;
        break;
      }
      if (budget.exhausted || budget.used === 0) {
        const wait = Math.min(msUntilNextHour(), deadline - Date.now());
        if (wait <= 0) break;
        console.log(`Paused for the hourly limit; resuming in ${Math.round(wait / 60000)} min`);
        await sleep(wait);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log(done ? 'Backfill complete.' : 'Time limit reached; run again to continue.');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `done=${done}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
