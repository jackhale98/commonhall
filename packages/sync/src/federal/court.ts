/**
 * Supreme Court opinions from CourtListener: one row per decided case (opinion
 * cluster), the last five terms, refreshed hourly. The first load reads one
 * calendar month per request, oldest first, so no single query is long enough
 * to hit a paging limit. After that each run re-reads the last month of
 * decisions (citations and opinions are filled in after release), so a quiet
 * hour costs one request.
 */
import { BudgetExhaustedError, type ClCluster, type CourtListenerClient } from '@civic/congress-client';
import { upsertIfChanged } from '../db.ts';
import type { JobRun } from '../job.ts';

export const SCOTUS_JOB = 'scotus';
export const COURTLISTENER_API = 'courtlistener';
/** First day of the oldest term loaded on the first run. */
export const SCOTUS_SINCE = '2020-10-01';

export interface ScotusCursor {
  [key: string]: unknown;
  /** Newest decision date seen (YYYY-MM-DD). */
  newest?: string;
  /** Last day of the newest month the first load has finished (YYYY-MM-DD). */
  filledThrough?: string;
}

/** The first and last day of each calendar month from `since`'s month to `today`'s. */
export function monthWindows(since: string, today: string): [string, string][] {
  const out: [string, string][] = [];
  let [y, m] = since.split('-').map(Number) as [number, number];
  const end = today.slice(0, 7);
  while (`${y}-${String(m).padStart(2, '0')}` <= end) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push([first, last]);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

export interface ScotusCaseRow extends Record<string, unknown> {
  cluster_id: number;
  docket_id: number | null;
  case_name: string;
  case_name_full: string | null;
  docket_number: string | null;
  date_filed: string;
  date_argued: string | null;
  term: number;
  citations: string[];
  url: string;
  judges: string | null;
  opinion_types: string[];
  dissents: number;
  concurrences: number;
  per_curiam: boolean;
  syllabus: string | null;
}

/** October Term year: decisions from October 2025 to September 2026 belong to OT2025. */
export function supremeCourtTerm(date: string): number {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m >= 10 ? y : y - 1;
}

export function scotusCaseRow(c: ClCluster): ScotusCaseRow {
  const types = c.opinions.map((o) => o.type ?? 'unknown');
  return {
    cluster_id: c.cluster_id,
    docket_id: c.docket_id ?? null,
    case_name: c.caseName.trim(),
    case_name_full: c.caseNameFull?.trim() || null,
    docket_number: c.docketNumber?.trim() || null,
    date_filed: c.dateFiled,
    date_argued: c.dateArgued ?? null,
    term: supremeCourtTerm(c.dateFiled),
    citations: c.citation ?? [],
    url: new URL(c.absolute_url, 'https://www.courtlistener.com').toString(),
    judges: c.judge?.trim() || null,
    opinion_types: types,
    // Counted only when listed separately; a "combined-opinion" document can hold dissents too.
    dissents: types.filter((t) => t === 'dissent').length,
    concurrences: types.filter((t) => t === 'concurrence-opinion' || t === 'in-part-opinion').length,
    per_curiam: c.opinions.some((o) => o.per_curiam),
    syllabus: c.syllabus?.trim() || null,
  };
}

export async function syncSupremeCourt(
  run: JobRun<ScotusCursor>,
  options: { client: CourtListenerClient; now?: () => Date },
): Promise<ScotusCursor> {
  const today = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
  const cursor = { ...run.cursor };
  const read = async (since: string, until?: string) => {
    let seen = 0;
    for await (const cluster of options.client.supremeCourtOpinions(since, until)) {
      seen++;
      const row = scotusCaseRow(cluster);
      if (await upsertIfChanged(run.sql, 'public.scotus_cases', ['cluster_id'], row)) run.rowsWritten++;
      if (!cursor.newest || row.date_filed > cursor.newest) cursor.newest = row.date_filed;
    }
    return seen;
  };
  try {
    if (!cursor.filledThrough || cursor.filledThrough < today) {
      // First load, a month at a time; the cursor records each finished month.
      for (const [first, last] of monthWindows(cursor.filledThrough ?? SCOTUS_SINCE, today)) {
        if (cursor.filledThrough && last <= cursor.filledThrough) continue;
        if (run.outOfTime()) return cursor;
        const seen = await read(first, last);
        run.log('scotus: month', { first, seen });
        cursor.filledThrough = last;
      }
      return cursor;
    }
    const since = new Date(Date.parse(cursor.newest ?? today) - 30 * 86_400_000).toISOString().slice(0, 10);
    const seen = await read(since);
    run.log('scotus', { since, seen, written: run.rowsWritten });
    return cursor;
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    run.log('scotus: budget exhausted', {});
    // Finished months stay recorded; the current one is read again next run.
    return cursor;
  }
}
