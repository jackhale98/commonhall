/** Supreme Court decisions as stored by sync-scotus. */
export interface ScotusCase {
  cluster_id: number;
  case_name: string;
  docket_number: string | null;
  date_filed: string;
  date_argued: string | null;
  term: number;
  citations: string[];
  url: string;
  dissents: number;
  concurrences: number;
  per_curiam: boolean;
  /** CourtListener's judges field: usually the opinion's author, or "Per Curiam". */
  judges: string | null;
}

export const SCOTUS_COLUMNS =
  'cluster_id,case_name,docket_number,date_filed,date_argued,term,citations,url,dissents,concurrences,per_curiam,judges';

/** October Term year for a date: October 2025 to September 2026 is OT2025. */
export function supremeCourtTerm(date: Date): number {
  return date.getUTCMonth() >= 9 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

/** supremecourt.gov docket page, e.g. 22-451. Applications (22A123) and originals use the same path. */
export function docketUrl(docket: string): string {
  return `https://www.supremecourt.gov/docket/docketfiles/html/public/${encodeURIComponent(docket.split(/[,\s]/)[0]!)}.html`;
}

/** Compact decision row for the court explorer (cases.json). */
export interface CaseRow {
  i: number;
  /** Case name. */
  n: string;
  /** Docket number. */
  k: string | null;
  /** First citation. */
  c: string | null;
  /** Decision date. */
  d: string;
  /** October Term. */
  t: number;
  /** Dissents and concurrences listed separately. */
  ds: number;
  cc: number;
  pc?: 1;
  /** Opinion author ("Per Curiam" for unsigned opinions). */
  j?: string;
  /** Who won (Supreme Court Database): p petitioner, r respondent, u unclear. */
  w?: 'p' | 'r' | 'u';
  /** Vote split, e.g. "6–3". */
  v?: string;
  /** Argued before the Court (not a summary decision). */
  a?: 1;
  /** Has a discussion. */
  x?: 1;
}

/** CourtListener spellings that differ from the Justices' names. */
const AUTHOR_FIXES: Record<string, string> = { 'Elana Kagan': 'Elena Kagan' };

/** The opinion's author from the judges field, or "Per Curiam"; null when it lists several names. */
export function opinionAuthor(c: Pick<ScotusCase, 'judges' | 'per_curiam'>): string | null {
  const j = c.judges?.trim();
  if (c.per_curiam || /^per curiam/i.test(j ?? '')) return 'Per Curiam';
  if (!j || /[,;]| and /.test(j)) return null;
  return AUTHOR_FIXES[j] ?? j;
}

export function caseRows(
  cases: ScotusCase[],
  hasDiscussion: (id: number) => boolean,
  outcomes: Map<number, ScotusOutcome> = new Map(),
): CaseRow[] {
  return cases.map((c) => {
    const row: CaseRow = {
      i: c.cluster_id,
      n: c.case_name,
      k: c.docket_number,
      c: c.citations[0] ?? null,
      d: c.date_filed,
      t: c.term,
      ds: c.dissents,
      cc: c.concurrences,
    };
    const author = opinionAuthor(c);
    if (author === 'Per Curiam') row.pc = 1;
    if (author) row.j = author;
    if (c.date_argued) row.a = 1;
    const o = outcomes.get(c.cluster_id);
    const w = o && winner(o);
    if (w) row.w = w === 'petitioner' ? 'p' : w === 'respondent' ? 'r' : 'u';
    const v = o && voteSplit(o);
    if (v) row.v = v;
    if (hasDiscussion(c.cluster_id)) row.x = 1;
    return row;
  });
}

/** A Supreme Court Database outcome (scotus_outcomes). */
export interface ScotusOutcome {
  scdb_case_id: string;
  term: number;
  docket: string | null;
  party_winning: number | null;
  case_disposition: number | null;
  maj_votes: number | null;
  min_votes: number | null;
}

export const SCOTUS_OUTCOME_COLUMNS = 'scdb_case_id,term,docket,party_winning,case_disposition,maj_votes,min_votes';

/** Docket numbers in a field such as "23-719, 23-724" or "22A123". */
const dockets = (s: string | null) => s?.match(/\d+-\d+|\d+A\d+/g) ?? [];

/** Each decision's outcome, matched by term and any shared docket number. */
export function matchOutcomes(
  cases: Pick<ScotusCase, 'cluster_id' | 'term' | 'docket_number'>[],
  outcomes: ScotusOutcome[],
): Map<number, ScotusOutcome> {
  const byDocket = new Map<string, ScotusOutcome>();
  for (const o of outcomes) for (const d of dockets(o.docket)) byDocket.set(`${o.term}:${d}`, o);
  const out = new Map<number, ScotusOutcome>();
  for (const c of cases) {
    const hit = dockets(c.docket_number)
      .map((d) => byDocket.get(`${c.term}:${d}`))
      .find(Boolean);
    if (hit) out.set(c.cluster_id, hit);
  }
  return out;
}

/** The sides of "A v. B" (the petitioner is named first at the Supreme Court). */
export function caseSides(name: string): { petitioner: string; respondent: string } | null {
  const m = /^(.+?)\s+v\.\s+(.+)$/.exec(name);
  return m ? { petitioner: m[1]!.trim(), respondent: m[2]!.trim() } : null;
}

export type Winner = 'petitioner' | 'respondent' | 'unclear';
export function winner(o: Pick<ScotusOutcome, 'party_winning'>): Winner | null {
  return o.party_winning === 1
    ? 'petitioner'
    : o.party_winning === 0
      ? 'respondent'
      : o.party_winning === 2
        ? 'unclear'
        : null;
}

/** "6–3", or null when the vote isn't recorded. */
export function voteSplit(o: Pick<ScotusOutcome, 'maj_votes' | 'min_votes'>): string | null {
  return o.maj_votes === null || o.min_votes === null ? null : `${o.maj_votes}–${o.min_votes}`;
}

/** SCDB caseDisposition, in plain words. */
export const DISPOSITION: Record<number, string> = {
  1: 'Stay, petition or motion granted',
  2: 'Affirmed',
  3: 'Reversed',
  4: 'Reversed and remanded',
  5: 'Vacated and remanded',
  6: 'Affirmed in part, reversed in part',
  7: 'Affirmed in part, reversed in part, and remanded',
  8: 'Vacated',
  9: 'Petition denied or appeal dismissed',
  10: 'Certified to or from a lower court',
  11: 'No disposition',
};

/** One line on who won, e.g. "Petitioner (Trump) won, 6–3". */
export function outcomeSummary(caseName: string, o: ScotusOutcome): string | null {
  const w = winner(o);
  if (!w) return null;
  const sides = caseSides(caseName);
  const who =
    w === 'unclear'
      ? 'Mixed or unclear result'
      : `${w === 'petitioner' ? 'Petitioner' : 'Respondent'}${sides ? ` (${sides[w]})` : ''} won`;
  const v = voteSplit(o);
  return v ? `${who}, ${v}${o.min_votes === 0 ? ' (unanimous)' : ''}` : who;
}
