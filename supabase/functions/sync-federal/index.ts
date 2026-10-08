/**
 * Every 10 minutes (pg_cron): new House and Senate roll calls, then bills changed
 * since the last cursor, writing a feed event for each new action, cosponsor,
 * bill and vote on a bill. Each run is time-boxed and
 * capped so six runs stay within ~3,500 Congress.gov requests an hour, leaving
 * headroom for on-demand fetches.
 */
import { CongressClient, SenateClient, congressForDate } from '@civic/congress-client';
import {
  BILLS_JOB,
  billEvents,
  hourlyBudget,
  runJob,
  sessionsToSync,
  syncBillsIncremental,
  syncVotes,
  VOTES_JOB,
  writeFeedEvents,
  type BillsCursor,
  type VotesCursor,
} from '@civic/sync';
import { env, envNumber, serveJob, timeLimitMs } from '../_shared/runtime.ts';

serveJob('sync-federal', async ({ sql, log }) => {
  const congress = congressForDate(new Date());
  const budget = await hourlyBudget(sql, 'congress', envNumber('SYNC_FEDERAL_RUN_CAP', 580));
  const client = new CongressClient({ apiKey: env('CONGRESS_API_KEY'), budget });
  const limit = timeLimitMs();
  const started = Date.now();

  // Votes first: few per hour and cheap, so they never wait behind a busy bill window.
  const votes = await runJob<VotesCursor>({
    sql,
    job: VOTES_JOB,
    timeLimitMs: Math.round(limit * 0.3),
    budgets: { congress: budget },
    log,
    run: async (ctx) =>
      (
        await syncVotes(sql, ctx.cursor, {
          congress,
          sessions: sessionsToSync(new Date()),
          client,
          senate: new SenateClient(),
          outOfTime: ctx.outOfTime,
          log,
          senateLimit: 20,
        })
      ).cursor,
  });

  const bills = await runJob<BillsCursor>({
    sql,
    job: BILLS_JOB,
    timeLimitMs: Math.max(10_000, limit - (Date.now() - started)),
    budgets: { congress: budget },
    log,
    run: async (ctx) =>
      (
        await syncBillsIncremental(ctx, {
          congress,
          client,
          concurrency: envNumber('SYNC_CONCURRENCY', 3),
          onChange: (change) => writeFeedEvents(sql, billEvents(change)),
        })
      ).cursor,
  });

  return { congress, votes, bills };
});
