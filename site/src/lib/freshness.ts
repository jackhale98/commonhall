/**
 * How current a page's data is, for the note under each data section (SourceNote):
 * when its update job last finished cleanly, whether that job is behind, and, while a
 * source's records are still being loaded, how many we hold of how many. Details still
 * being added to records we already hold are not mentioned (docs/decisions.md §126).
 * The same functions write the note at build time and again in the browser.
 */
import { formatDate, formatDateTime } from './format';

/** An update job or dataset as public.data_status reports it (the Data status page). */
export interface StatusRow {
  kind: 'job' | 'data';
  name: string;
  label: string;
  last_ok: string | null;
  newest: string | null;
  problem: string | null;
}

/** A source's record count against its upstream total (public.data_coverage). */
export interface CoverageRow {
  source: string;
  held: number;
  expected: number;
  counted_at: string;
}

/** Below this share of the upstream total, a source is still loading (above it, the gap is today's new records). */
export const LOADING_BELOW = 0.98;
/** An upstream total older than this is not trusted to say a source is loading. */
const TOTAL_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export interface NoteState {
  /** When the slowest of the section's jobs last finished cleanly. */
  lastOk: string | null;
  /** The health check's word for a job that is behind ("overdue", "last run failed"). */
  problem: string | null;
  /** Set while the source's records are still loading. */
  loading: { held: number; expected: number } | null;
}

export function noteState(
  status: readonly StatusRow[],
  coverage: readonly CoverageRow[],
  jobs: readonly string[],
  coverageKey: string | undefined,
  now: Date,
): NoteState {
  const rows = status.filter((r) => r.kind === 'job' && jobs.includes(r.name));
  const times = rows.map((r) => r.last_ok);
  const lastOk = times.length && times.every(Boolean) ? [...(times as string[])].sort()[0]! : null;
  const problem = rows.find((r) => r.problem)?.problem ?? null;
  const c = coverageKey ? coverage.find((r) => r.source === coverageKey) : undefined;
  const loading =
    c &&
    c.expected > 0 &&
    c.held < c.expected * LOADING_BELOW &&
    now.getTime() - new Date(c.counted_at).getTime() < TOTAL_MAX_AGE_MS
      ? { held: c.held, expected: c.expected }
      : null;
  return { lastOk, problem, loading };
}

/** "just now", "12 minutes ago", "3 hours ago", "yesterday", then the date. */
export function timeAgo(iso: string, now: Date): string {
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  if (hours < 48) return 'yesterday';
  return `on ${formatDate(iso)}`;
}

export interface NoteText {
  /** "Still loading: 9,512 of 19,716 bills so far." */
  loading: string | null;
  /** "Updated from Congress.gov 12 minutes ago." or the delay warning. */
  fresh: string;
  /** The exact time of the last update, for a tooltip ("Oct 21, 2026, 11:48 AM EDT"). */
  exact: string | null;
  delayed: boolean;
}

/**
 * The note's sentences. `live` is false at build time: the page may be read a day
 * later, so it gives the date and time rather than "minutes ago".
 */
export function noteText(state: NoteState, source: string, what: string, now: Date, live: boolean): NoteText {
  const loading = state.loading
    ? `Still loading: ${state.loading.held.toLocaleString('en-US')} of ${state.loading.expected.toLocaleString('en-US')} ${what} so far.`
    : null;
  const exact = state.lastOk ? formatDateTime(state.lastOk) : null;
  const when = state.lastOk ? (live ? timeAgo(state.lastOk, now) : `on ${exact}`) : null;
  // Without a source (inside a line that already names it): "Last updated …".
  const from = source ? ` from ${source}` : '';
  if (state.problem)
    return {
      loading,
      fresh: when ? `Updates${from} are delayed; last updated ${when}.` : `Updates${from} are delayed.`,
      exact,
      delayed: true,
    };
  return {
    loading,
    fresh: when ? (source ? `Updated${from} ${when}.` : `Last updated ${when}.`) : source ? `From ${source}.` : '',
    exact,
    delayed: false,
  };
}

/** What a SourceNote needs: the update jobs behind a section and where its data comes from. */
export interface SectionSource {
  jobs: string[];
  source: string;
  what?: string;
}

/** The national and state sections' sources (private.job_schedule names; a DB test checks they exist). */
export const SOURCES = {
  bills: { jobs: ['federal-bills'], source: 'Congress.gov', what: 'bills' },
  votes: { jobs: ['federal-votes'], source: 'Congress.gov and senate.gov' },
  members: { jobs: ['federal-members'], source: 'Congress.gov and congress-legislators' },
  committees: { jobs: ['committees'], source: 'Congress.gov' },
  federalBudget: { jobs: ['federal-budget'], source: 'the Treasury and USAspending' },
  executive: { jobs: ['executive'], source: 'the Federal Register and Congress.gov' },
  court: { jobs: ['scotus'], source: 'CourtListener' },
  stateBills: { jobs: ['state'], source: 'Open States', what: 'bills' },
  legislators: { jobs: ['load-state-people'], source: 'Open States' },
  stateCourts: { jobs: ['state-courts'], source: 'CourtListener' },
} satisfies Record<string, SectionSource>;

/** Each state's budget source. */
export const STATE_BUDGET_SOURCES: Record<string, SectionSource> = {
  MA: { jobs: ['state-budget'], source: 'the Comptroller’s CTHRU' },
  CT: { jobs: ['state-budget'], source: 'data.ct.gov' },
};

/** Each state's governor's orders source. */
export const GOVERNOR_SOURCES: Record<string, SectionSource> = {
  MA: { jobs: ['load-ma-orders'], source: 'mass.gov' },
  CT: { jobs: ['load-ct-orders'], source: 'portal.ct.gov' },
};

/** Each city's update jobs by section (the council, 311, zoning, budget). */
export const CITY_JOBS: Record<
  string,
  { council: string[]; requests?: string[]; zoning?: string[]; budget?: string[] }
> = {
  'ma-boston': {
    council: ['boston'],
    requests: ['boston-311'],
    zoning: ['boston-zba'],
    budget: ['city-budget', 'capital-plan'],
  },
  'ma-worcester': { council: ['worcester', 'load-worcester-agendas'], budget: ['load-worcester-budget'] },
  'ma-somerville': { council: ['somerville'], requests: ['somerville-311'] },
  'ma-cambridge': { council: ['cambridge'], requests: ['cambridge-data'], budget: ['cambridge-data'] },
  'ct-bristol': { council: ['bristol'] },
  'ct-middletown': { council: ['load-middletown-agendas'], requests: ['middletown-311'] },
};

/** Every job name the site's notes refer to (for the test that they are scheduled). */
export function noteJobs(): string[] {
  const all = [
    ...Object.values(SOURCES),
    ...Object.values(STATE_BUDGET_SOURCES),
    ...Object.values(GOVERNOR_SOURCES),
  ].flatMap((s) => s.jobs);
  for (const c of Object.values(CITY_JOBS)) all.push(...Object.values(c).flat());
  return [...new Set(all)].sort();
}
