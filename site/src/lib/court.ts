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

export function caseRows(cases: ScotusCase[], hasDiscussion: (id: number) => boolean): CaseRow[] {
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
    if (hasDiscussion(c.cluster_id)) row.x = 1;
    return row;
  });
}
