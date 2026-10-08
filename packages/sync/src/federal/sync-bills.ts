/**
 * Incremental bill sync (hourly).
 *
 * Works through a fixed window [from, to] of bills whose Congress.gov updateDate
 * falls in it, oldest update first. If the run stops early (request budget or
 * time), the window and the IDs already processed in it are stored; the next run
 * lists the same window again from the start (one request per 250 bills) and
 * skips those IDs. Resuming by offset would be cheaper but can skip bills: when a
 * processed bill is updated again it leaves the window and later items shift
 * left. When a window completes, the next one starts five minutes before this
 * one ended (overlap; upserts make re-reads harmless).
 *
 * List-level updateDate values are date-only, so they cannot serve as a precise
 * cursor; see docs/decisions.md §2.
 */
import { BudgetExhaustedError, HttpError, billId, toApiDateTime, type CongressClient } from '@civic/congress-client';
import type { JobRun } from '../job.ts';
import { syncBill, type BillChange } from './bills.ts';

export interface BillsCursor extends Record<string, unknown> {
  /** Start of the next window (ISO). Set by the backfill when it finishes. */
  since?: string;
  window?: { from: string; to: string; done: string[] };
  congress?: number;
}

export const OVERLAP_MS = 5 * 60_000;
const CHECKPOINT_EVERY = 10;

export interface SyncBillsOptions {
  congress: number;
  client: CongressClient;
  now?: () => Date;
  /** Bills synced in parallel. Each bill's own requests stay sequential. Default 1. */
  concurrency?: number;
  /** Called after each bill is written (e.g. to emit feed events). */
  onChange?: (change: BillChange) => Promise<number | void>;
}

export interface SyncBillsOutcome {
  cursor: BillsCursor;
  processed: number;
  changed: number;
  completedWindow: boolean;
  stoppedBy?: 'budget' | 'time';
}

export async function syncBillsIncremental(
  run: JobRun<BillsCursor>,
  options: SyncBillsOptions,
): Promise<SyncBillsOutcome> {
  const { client, congress } = options;
  const now = options.now ?? (() => new Date());
  const cursor: BillsCursor = { ...run.cursor };

  if (!cursor.since && !cursor.window) {
    run.log('no cursor yet: run the backfill first (it sets the starting point)');
    return { cursor, processed: 0, changed: 0, completedWindow: false };
  }

  const window = cursor.window ?? { from: cursor.since!, to: toApiDateTime(now()), done: [] };
  const done = new Set(window.done);

  let processed = 0;
  let changed = 0;
  let stoppedBy: SyncBillsOutcome['stoppedBy'];

  const windowState = () => ({ ...window, done: [...done] });
  const save = async () => {
    await run.checkpoint({ ...cursor, congress, window: windowState() });
  };

  const concurrency = Math.max(1, options.concurrency ?? 1);
  const inFlight = new Set<Promise<void>>();
  let failure: unknown;

  const processBill = async (id: string, type: string, number: string | number, billCongress: number) => {
    try {
      const change = await syncBill(run.sql, client, billCongress, type, number);
      run.rowsWritten += change.rowsWritten;
      if (options.onChange) {
        const extra = await options.onChange(change);
        if (typeof extra === 'number') run.rowsWritten += extra;
      }
      if (change.rowsWritten > 0) changed += 1;
      processed += 1;
      done.add(id);
      if (processed % CHECKPOINT_EVERY === 0) await save();
    } catch (error) {
      // A permanent 4xx for one bill (e.g. withdrawn from the API) must not wedge the window.
      if (error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429) {
        run.log('skipping bill after client error', { bill: id, status: error.status });
        done.add(id);
        return;
      }
      failure ??= error;
    }
  };

  try {
    for await (const item of client.listBills(congress, {
      fromDateTime: window.from,
      toDateTime: window.to,
      sort: 'updateDate+asc',
    })) {
      if (failure) break;
      if (run.outOfTime()) {
        stoppedBy = 'time';
        break;
      }
      if (!item.type || !item.number) continue;
      const billCongress = item.congress ?? congress;
      const id = billId(billCongress, item.type, item.number);
      if (done.has(id)) continue;
      const task: Promise<void> = processBill(id, item.type, item.number, billCongress).finally(() =>
        inFlight.delete(task),
      );
      inFlight.add(task);
      if (inFlight.size >= concurrency) await Promise.race(inFlight);
    }
  } catch (error) {
    failure ??= error;
  }
  await Promise.all(inFlight);

  if (failure) {
    if (!(failure instanceof BudgetExhaustedError)) {
      await save();
      throw failure;
    }
    stoppedBy = 'budget';
  }

  if (stoppedBy) {
    await save();
    run.log(`stopped by ${stoppedBy}; will resume`, { done: done.size, processed, changed });
    return {
      cursor: { ...cursor, congress, window: windowState() },
      processed,
      changed,
      completedWindow: false,
      stoppedBy,
    };
  }

  const nextSince = toApiDateTime(new Date(new Date(window.to).getTime() - OVERLAP_MS));
  const next: BillsCursor = { since: nextSince, congress };
  run.log('window complete', { from: window.from, to: window.to, processed, changed });
  return { cursor: next, processed, changed, completedWindow: true };
}
