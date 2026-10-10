/**
 * State high court decisions from CourtListener: one row per decided case
 * (opinion cluster). The first load reads a month per request, newest first, back
 * to each court's start date, so recent decisions show up first; after that each
 * run re-reads the last month (citations and opinions are filled in after release). CourtListener's free
 * tier is small (50 requests an hour, 125 a day, shared with the Supreme Court
 * sync), so this runs every few hours with a few requests each time.
 */
import {
  BudgetExhaustedError,
  RateLimitedError,
  type ClCluster,
  type CourtListenerClient,
} from '@civic/congress-client';
import { upsertIfChanged } from '../db.ts';
import { htmlText, monthWindows } from '../federal/court.ts';
import { opinionSummary } from './opinion-text.ts';
import type { JobRun } from '../job.ts';

export const STATE_COURTS_JOB = 'state-courts';

/** The courts we follow: CourtListener's court id, the state, and how far back the first load reads. */
export const STATE_COURTS = [{ court: 'mass', state: 'MA', since: '2024-01-01' }] as const;

export interface StateCourtsCursor {
  [key: string]: unknown;
  /**
   * Per court: the newest decision seen; `loadedFrom`, the first day of the oldest month
   * the newest-first load has read; `filledThrough`, how far an earlier oldest-first
   * load got (those months aren't read again); `filled` once the first load is done.
   */
  courts?: Record<string, { filledThrough?: string; loadedFrom?: string; newest?: string; filled?: boolean }>;
  pausedUntil?: string;
}

const RATE_LIMIT_PAUSE_MS = 60 * 60 * 1000;

export function stateCourtCaseRow(c: ClCluster, state: string) {
  const types = c.opinions.map((o) => o.type ?? 'unknown');
  return {
    cluster_id: c.cluster_id,
    court_id: c.court_id,
    state,
    case_name: c.caseName.trim(),
    case_name_full: c.caseNameFull?.trim() || null,
    docket_number: c.docketNumber?.trim() || null,
    date_filed: c.dateFiled,
    date_argued: c.dateArgued ?? null,
    citations: c.citation ?? [],
    url: new URL(c.absolute_url, 'https://www.courtlistener.com').toString(),
    judges: c.judge?.trim() || null,
    opinion_types: types,
    dissents: types.filter((t) => t === 'dissent').length,
    concurrences: types.filter((t) => t === 'concurrence-opinion' || t === 'in-part-opinion').length,
    per_curiam: c.opinions.some((o) => o.per_curiam),
    summary: c.syllabus?.trim() || null,
    opinion_ids: c.opinions.map((o) => o.id),
  };
}

/** How many decisions one run reads the opinion text for (one request each), newest first. */
const TEXTS_PER_RUN = 6;

/**
 * Read each decision's opinion text once for what it is about: the reporter's
 * subject keywords and the opinion's opening paragraph (opinion-text.ts). Newest
 * decisions first; stops when the request budget runs out.
 */
export async function fillCaseText(run: JobRun<StateCourtsCursor>, client: CourtListenerClient): Promise<number> {
  const due = await run.sql<{ cluster_id: number; opinion_ids: number[] }[]>`
    select cluster_id, opinion_ids from public.state_court_cases
     where text_checked_at is null and cardinality(opinion_ids) > 0
     order by date_filed desc limit ${TEXTS_PER_RUN}`;
  let found = 0;
  for (const c of due) {
    if (run.outOfTime()) break;
    try {
      const opinion = await client.opinionText(Number(c.opinion_ids[0]));
      const text = opinion.plain_text?.trim() || htmlText(opinion.html_with_citations ?? '');
      const { keywords, opening } = opinionSummary(text);
      await run.sql`
        update public.state_court_cases
           set keywords = ${keywords}, opening = ${opening}, text_checked_at = now()
         where cluster_id = ${c.cluster_id}`;
      if (keywords || opening) {
        found++;
        run.rowsWritten++;
      }
    } catch (error) {
      if (error instanceof BudgetExhaustedError) throw error;
      run.log('state-courts: opinion text failed', { cluster: c.cluster_id, error: String(error) });
    }
  }
  if (due.length) run.log('state-courts: opinion texts', { checked: due.length, found });
  return found;
}

export async function syncStateCourts(
  run: JobRun<StateCourtsCursor>,
  options: {
    client: CourtListenerClient;
    now?: () => Date;
    courts?: readonly { court: string; state: string; since: string }[];
  },
): Promise<StateCourtsCursor> {
  const now = options.now?.() ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const cursor: StateCourtsCursor = { ...run.cursor, courts: { ...run.cursor.courts } };
  if (cursor.pausedUntil && Date.parse(cursor.pausedUntil) > now.getTime()) {
    run.log('state-courts: paused by CourtListener rate limit', { until: cursor.pausedUntil });
    return cursor;
  }
  delete cursor.pausedUntil;
  try {
    for (const { court, state, since } of options.courts ?? STATE_COURTS) {
      const at = (cursor.courts![court] ??= {});
      const read = async (first: string, last?: string) => {
        let seen = 0;
        for await (const cluster of options.client.courtOpinions(court, first, last)) {
          seen++;
          const row = stateCourtCaseRow(cluster, state);
          if (await upsertIfChanged(run.sql, 'public.state_court_cases', ['cluster_id'], row)) run.rowsWritten++;
          if (!at.newest || row.date_filed > at.newest) at.newest = row.date_filed;
        }
        return seen;
      };
      if (!at.filled) {
        // Newest month first, back to the start date, skipping months already read.
        const months = monthWindows(since, today).reverse();
        for (const [first, last] of months) {
          if (at.filledThrough && last <= at.filledThrough) continue;
          if (at.loadedFrom && first >= at.loadedFrom) continue;
          if (run.outOfTime()) return cursor;
          const seen = await read(first, last);
          run.log('state-courts: month', { court, first, seen });
          at.loadedFrom = first;
          await run.checkpoint(cursor);
        }
        at.filled = true;
        await run.checkpoint(cursor);
        continue;
      }
      const from = new Date(Date.parse(at.newest ?? today) - 30 * 86_400_000).toISOString().slice(0, 10);
      const seen = await read(from);
      run.log('state-courts', { court, since: from, seen });
    }
    // Whatever budget is left goes to reading what decisions are about.
    await fillCaseText(run, options.client);
    return cursor;
  } catch (error) {
    if (!(error instanceof BudgetExhaustedError)) throw error;
    if (error instanceof RateLimitedError) {
      const waitMs = Math.max(error.retryAfterMs ?? RATE_LIMIT_PAUSE_MS, RATE_LIMIT_PAUSE_MS);
      cursor.pausedUntil = new Date(now.getTime() + waitMs).toISOString();
      run.log('state-courts: rate-limited by CourtListener', { pausedUntil: cursor.pausedUntil });
      return cursor;
    }
    run.log('state-courts: budget exhausted', {});
    return cursor;
  }
}
