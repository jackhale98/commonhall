/**
 * Steps the backfill runs after members and bills. Later phases (votes) add
 * theirs here; each returns true when finished and keeps its own progress in
 * `state`, which is saved in the backfill cursor.
 */
import type { CongressClient, LegislatorsClient } from '@civic/congress-client';
import type { BackfillCursor, JobRun } from '@civic/sync';

export interface StepDeps {
  congress: number;
  client: CongressClient;
  legislators: LegislatorsClient;
}

export function backfillExtraSteps(_deps: StepDeps) {
  return async (_run: JobRun<BackfillCursor>, _state: Record<string, unknown>): Promise<boolean> => true;
}
