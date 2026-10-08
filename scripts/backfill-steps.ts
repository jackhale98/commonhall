/**
 * Steps the backfill runs after members and bills: every House and Senate roll
 * call of the Congress so far. Each step keeps its progress in `state`, which is
 * saved in the backfill cursor; returns true when finished.
 */
import { SenateClient, congressForDate, type CongressClient, type LegislatorsClient } from '@civic/congress-client';
import { sessionsToSync, syncVotes, type BackfillCursor, type JobRun, type VotesCursor } from '@civic/sync';

export interface StepDeps {
  congress: number;
  client: CongressClient;
  legislators: LegislatorsClient;
  now?: Date;
}

/** Sessions of `congress` that have started by `now`. */
export function sessionsSoFar(congress: number, now: Date): number[] {
  const current = congressForDate(now);
  if (congress < current) return [1, 2];
  return sessionsToSync(now).includes(2) ? [1, 2] : [1];
}

export function backfillExtraSteps(deps: StepDeps) {
  return async (run: JobRun<BackfillCursor>, state: Record<string, unknown>): Promise<boolean> => {
    if (state.votesDone) return true;
    const result = await syncVotes(run.sql, (state.votes as VotesCursor | undefined) ?? {}, {
      congress: deps.congress,
      sessions: sessionsSoFar(deps.congress, deps.now ?? new Date()),
      client: deps.client,
      senate: new SenateClient(),
      outOfTime: run.outOfTime,
      log: run.log,
      senateLimit: Number.POSITIVE_INFINITY,
      senateDelayMs: 250,
    });
    run.rowsWritten += result.rowsWritten;
    state.votes = result.cursor;
    run.log('votes backfilled', { house: result.house, senate: result.senate, complete: result.complete });
    if (result.complete) state.votesDone = true;
    return result.complete;
  };
}
