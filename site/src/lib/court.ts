import { SCDB_ISSUE_AREAS, SCDB_ISSUES } from './scdb-issues';
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
  /** Topic (SCDB issue area and specific issue). */
  ta?: string;
  ti?: string;
  /** Start of the syllabus background. */
  s?: string;
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
  about: Map<number, CaseAbout> = new Map(),
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
    const a = about.get(c.cluster_id);
    if (a?.area) row.ta = a.area;
    if (a?.issue) row.ti = a.issue;
    if (a?.summary) row.s = summaryPreview(a.summary);
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

/** What a case is about: SCDB topic labels and the syllabus background (each may be missing). */
export interface CaseAbout {
  /** Issue area, e.g. "Criminal Procedure". */
  area?: string;
  /** Specific issue, e.g. "Search and seizure". */
  issue?: string;
  /** Background part of the Court's syllabus, word for word. */
  summary?: string;
}

/** SCDB topic codes in words (unknown or "miscellaneous" codes give no label). */
export function caseTopic(issueArea: number | null, issue: number | null): Pick<CaseAbout, 'area' | 'issue'> {
  const area = issueArea === null ? undefined : SCDB_ISSUE_AREAS[issueArea];
  const specific = issue === null ? undefined : SCDB_ISSUES[issue];
  return { ...(area && area !== 'Miscellaneous' ? { area } : {}), ...(specific ? { issue: specific } : {}) };
}

/** The first `max` characters of a summary, cut at a word, for lists. */
export function summaryPreview(text: string, max = 180): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max);
  return `${text.slice(0, cut > max / 2 ? cut : max).replace(/[,;:(—–-]+$/, '')}…`;
}

/**
 * A long summary split after the first sentence that ends past `min` characters, for
 * "read more". Sentence ends follow a lowercase letter, digit or bracket, so
 * abbreviations such as "U. S." or "W. Va." are not taken for one.
 */
export function splitSummary(text: string, min = 450): [string, string] {
  const re = /[a-z0-9)\]”’]\.(?=\s+[A-Z“])/g;
  re.lastIndex = min;
  const m = re.exec(text);
  if (!m || text.length - (m.index + 2) < 200) return [text, ''];
  return [text.slice(0, m.index + 2), text.slice(m.index + 2).trim()];
}

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

/** One cluster per decision: the lowest id among those with the same docket (or name) and date. Order is kept. */
export function dedupeScotus<
  T extends { cluster_id: number; docket_number: string | null; case_name: string; date_filed: string },
>(rows: T[]): T[] {
  const key = (r: T) => `${r.docket_number ?? r.case_name.toLowerCase()}|${r.date_filed}`;
  const keep = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    const seen = keep.get(k);
    if (seen === undefined || r.cluster_id < seen) keep.set(k, r.cluster_id);
  }
  return rows.filter((r) => keep.get(key(r)) === r.cluster_id);
}
