/**
 * Supreme Court opinions from CourtListener: one row per decided case (opinion
 * cluster), the last five terms, refreshed hourly. Each run re-reads the last
 * month of decisions (citations and opinions are filled in after release), so a
 * quiet hour costs one request.
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
  options: { client: CourtListenerClient },
): Promise<ScotusCursor> {
  const since = run.cursor.newest
    ? new Date(Date.parse(run.cursor.newest) - 30 * 86_400_000).toISOString().slice(0, 10)
    : SCOTUS_SINCE;
  let newest = run.cursor.newest;
  let seen = 0;
  try {
    for await (const cluster of options.client.supremeCourtOpinions(since)) {
      if (run.outOfTime()) break;
      seen++;
      const row = scotusCaseRow(cluster);
      if (await upsertIfChanged(run.sql, 'public.scotus_cases', ['cluster_id'], row)) run.rowsWritten++;
      if (!newest || row.date_filed > newest) newest = row.date_filed;
    }
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    run.log('scotus: budget exhausted', {});
    // Keep the old cursor so the next run re-reads the same window.
    return run.cursor;
  }
  run.log('scotus', { since, seen, written: run.rowsWritten });
  // Results come newest first, so an unfinished first load keeps the cursor empty and starts over.
  return run.outOfTime() && !run.cursor.newest ? run.cursor : { newest };
}
