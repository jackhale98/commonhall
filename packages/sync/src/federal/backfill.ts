/**
 * One-off federal backfill for a Congress: members, then every bill of every
 * type, walking bill numbers 1..max. Numbers are assigned densely in order of
 * introduction, so the cursor is simply (type, next number); this is stable
 * while the list endpoint's ordering is not. Gaps (404s) are skipped.
 *
 * When the bills finish, the hourly sync's cursor is set to the backfill's start
 * time so every change made during the backfill is picked up.
 */
import {
  BudgetExhaustedError,
  BILL_TYPES,
  HttpError,
  toApiDateTime,
  type CongressClient,
  type LegislatorsClient,
} from '@civic/congress-client';
import { setCursor, getCursor, type JobRun } from '../job.ts';
import { syncBill, type BillChange } from './bills.ts';
import { syncMembers } from './members.ts';
import { OVERLAP_MS, type BillsCursor } from './sync-bills.ts';

export const BILLS_JOB = 'federal-bills';

export interface BackfillCursor extends Record<string, unknown> {
  congress?: number;
  startedAt?: string;
  step?: 'members' | 'bills' | 'extra' | 'done';
  typeIndex?: number;
  nextNumber?: number;
  maxNumbers?: Record<string, number>;
  billsDone?: number;
  /** Free-form cursor for steps added in later phases (e.g. votes). */
  extra?: Record<string, unknown>;
}

export interface BackfillOptions {
  congress: number;
  client: CongressClient;
  legislators: LegislatorsClient;
  now?: () => Date;
  /** Extra steps run after bills (votes, …). Return true when finished. */
  extraSteps?: (run: JobRun<BackfillCursor>, state: Record<string, unknown>) => Promise<boolean>;
  onBill?: (change: BillChange) => void;
}

/** Highest bill number of `type` in `congress` (0 if none). */
export async function maxBillNumber(client: CongressClient, congress: number, type: string): Promise<number> {
  const page = await client.get<{ bills?: { number?: string }[] }>(`/bill/${congress}/${type}`, {
    sort: 'introducedDate+desc',
    limit: 5,
  });
  return Math.max(0, ...(page.bills ?? []).map((b) => Number(b.number ?? 0)).filter(Number.isFinite));
}

export async function runBackfill(run: JobRun<BackfillCursor>, options: BackfillOptions): Promise<BackfillCursor> {
  const { client, congress } = options;
  const now = options.now ?? (() => new Date());
  let cursor: BackfillCursor = { ...run.cursor };

  if (cursor.congress !== congress || !cursor.step) {
    cursor = { congress, startedAt: toApiDateTime(now()), step: 'members', billsDone: 0 };
    await run.checkpoint(cursor);
  }

  try {
    if (cursor.step === 'members') {
      const result = await syncMembers(run.sql, {
        congress,
        client,
        legislators: options.legislators,
        includeHistorical: true,
      });
      run.rowsWritten += result.rowsWritten;
      run.log('members synced', result);
      cursor = { ...cursor, step: 'bills', typeIndex: 0, nextNumber: 1, maxNumbers: {} };
      await run.checkpoint(cursor);
    }

    while (cursor.step === 'bills') {
      if (run.outOfTime()) return cursor;
      const type = BILL_TYPES[cursor.typeIndex ?? 0];
      if (!type) {
        cursor = { ...cursor, step: 'extra', extra: cursor.extra ?? {} };
        await run.checkpoint(cursor);
        break;
      }
      const maxNumbers = { ...(cursor.maxNumbers ?? {}) };
      if (maxNumbers[type] === undefined) {
        maxNumbers[type] = await maxBillNumber(client, congress, type);
        cursor = { ...cursor, maxNumbers };
        run.log('bill type range', { type, max: maxNumbers[type] });
      }
      let n = cursor.nextNumber ?? 1;
      let sinceCheckpoint = 0;
      while (n <= maxNumbers[type]!) {
        if (run.outOfTime()) break;
        try {
          const change = await syncBill(run.sql, client, congress, type, n);
          run.rowsWritten += change.rowsWritten;
          options.onBill?.(change);
        } catch (error) {
          if (!(error instanceof HttpError && error.status === 404)) throw error;
        }
        n += 1;
        cursor = { ...cursor, nextNumber: n, billsDone: (cursor.billsDone ?? 0) + 1 };
        if (++sinceCheckpoint >= 10) {
          await run.checkpoint(cursor);
          sinceCheckpoint = 0;
        }
      }
      await run.checkpoint(cursor);
      if (n > maxNumbers[type]!) {
        cursor = { ...cursor, typeIndex: (cursor.typeIndex ?? 0) + 1, nextNumber: 1 };
        await run.checkpoint(cursor);
      }
    }

    if (cursor.step === 'extra') {
      const state = { ...(cursor.extra ?? {}) };
      const finished = options.extraSteps ? await options.extraSteps(run, state) : true;
      cursor = { ...cursor, extra: state };
      if (!finished) {
        await run.checkpoint(cursor);
        return cursor;
      }
      cursor = { ...cursor, step: 'done' };
      await run.checkpoint(cursor);
      await handOff(run, cursor);
    }
  } catch (error) {
    if (error instanceof BudgetExhaustedError) {
      await run.checkpoint(cursor);
      run.log('hourly budget used up; pausing', { billsDone: cursor.billsDone });
      return cursor;
    }
    throw error;
  }
  return cursor;
}

/** Point the hourly sync at the moment the backfill began (minus overlap), unless it already runs. */
async function handOff(run: JobRun<BackfillCursor>, cursor: BackfillCursor): Promise<void> {
  const existing = await getCursor<BillsCursor>(run.sql, BILLS_JOB);
  if (existing.since || existing.window) return;
  const since = toApiDateTime(new Date(new Date(cursor.startedAt!).getTime() - OVERLAP_MS));
  await setCursor(run.sql, BILLS_JOB, { since, congress: cursor.congress });
  run.log('handed off to hourly sync', { since });
}
