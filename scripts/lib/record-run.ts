/**
 * Record a loader's run in `sync_state` like the scheduled jobs (start, success or
 * error, rows written, and a lease so two runs don't overlap), so the daily health
 * check (private.sync_health) covers the GitHub Actions loaders too. Throws when the
 * run fails, so the workflow fails as before.
 */
import { runJob, type Sql } from '@civic/sync';

export async function recordRun(
  sql: unknown,
  job: string,
  minutes: number,
  load: () => Promise<number>,
): Promise<void> {
  const result = await runJob({
    sql: sql as Sql,
    job,
    timeLimitMs: minutes * 60_000,
    log: (message, data) => {
      if (message !== 'done') console.log(message, data ?? '');
    },
    run: async (ctx) => {
      ctx.rowsWritten = await load();
      return ctx.cursor;
    },
  });
  if (result.status === 'skipped') console.log(`${job}: another run is in progress; skipped`);
  if (result.status === 'error') throw new Error(result.reason);
}
