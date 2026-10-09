/**
 * Supreme Court Database (SCDB, scdb.la.psu.edu): who won each case, how it was
 * disposed of and the vote split. Published about once a year as CSV files; the
 * loader (scripts/load-scdb.ts) finds the newest release, downloads the
 * case-centered file organised by citation and stores one row per case from
 * 2009 on. Nothing here is partisan: SCDB's ideological "direction" codes are
 * deliberately left out.
 */
import type { Sql } from '../db.ts';

export const SCDB_BASE = 'https://scdb.la.psu.edu';
/** The oldest term stored (matches the executive orders' range). */
export const SCDB_FIRST_TERM = 2009;

export interface ScdbOutcomeRow extends Record<string, unknown> {
  scdb_case_id: string;
  term: number;
  docket: string | null;
  us_cite: string | null;
  case_name: string;
  date_decision: string | null;
  party_winning: number | null;
  case_disposition: number | null;
  decision_type: number | null;
  maj_votes: number | null;
  min_votes: number | null;
  release: string;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

const int = (v: string | undefined) => (v && /^-?\d+$/.test(v.trim()) ? Number(v) : null);
/** SCDB dates are M/D/YYYY. */
const isoDate = (v: string | undefined) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v?.trim() ?? '');
  return m ? `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}` : null;
};

/** Rows from the case-centered CSV, from `firstTerm` on. */
export function scdbOutcomeRows(csv: string, release: string, firstTerm = SCDB_FIRST_TERM): ScdbOutcomeRow[] {
  const [header, ...records] = parseCsv(csv);
  if (!header) return [];
  const col = new Map(header.map((h, i) => [h.trim(), i]));
  for (const need of ['caseId', 'term', 'docket', 'caseName', 'partyWinning', 'majVotes', 'minVotes']) {
    if (!col.has(need)) throw new Error(`SCDB file has no "${need}" column; is it the case-centered file?`);
  }
  const get = (r: string[], name: string) => r[col.get(name) ?? -1]?.trim() || undefined;
  const out = new Map<string, ScdbOutcomeRow>();
  for (const r of records) {
    const term = int(get(r, 'term'));
    const id = get(r, 'caseId');
    if (!id || term === null || term < firstTerm) continue;
    out.set(id, {
      scdb_case_id: id,
      term,
      docket: get(r, 'docket') ?? null,
      us_cite: get(r, 'usCite') ?? null,
      case_name: get(r, 'caseName') ?? id,
      date_decision: isoDate(get(r, 'dateDecision')),
      party_winning: int(get(r, 'partyWinning')),
      case_disposition: int(get(r, 'caseDisposition')),
      decision_type: int(get(r, 'decisionType')),
      maj_votes: int(get(r, 'majVotes')),
      min_votes: int(get(r, 'minVotes')),
      release,
    });
  }
  return [...out.values()];
}

/** The newest release page linked from the data page, e.g. …/data/2026-release-01/. */
export function latestReleaseUrl(html: string): { url: string; release: string } | null {
  const found = [...html.matchAll(/\/data\/(\d{4})-release-(\d{2})\//g)].map((m) => ({
    release: `${m[1]}_${m[2]}`,
    url: `${SCDB_BASE}/data/${m[1]}-release-${m[2]}/`,
  }));
  found.sort((a, b) => b.release.localeCompare(a.release));
  return found[0] ?? null;
}

/**
 * The case-centered CSV organised by citation: the first "Download CSV" button
 * labelled "Organized by Supreme Court Citation" (case-centered files are listed
 * before the justice-centered ones). The loader checks the file name as well.
 */
export function caseCenteredCsvUrl(html: string): string | null {
  for (const m of html.matchAll(/href="([^"]*jet_download=[0-9a-f]+)"/g)) {
    const label = html
      .slice(m.index! + m[0].length, m.index! + m[0].length + 1500)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    if (/^\s*>?\s*Download CSV Organized by Supreme Court Citation\b/.test(label)) return m[1]!.replace(/&amp;/g, '&');
  }
  return null;
}

/** Replace the stored outcomes with a release's rows (one transaction). */
export async function writeScdbOutcomes(sql: Sql, rows: ScdbOutcomeRow[]): Promise<number> {
  if (rows.length === 0) throw new Error('No SCDB rows to load');
  await sql.begin(async (tx) => {
    await tx`delete from public.scotus_outcomes`;
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      await tx`insert into public.scotus_outcomes ${tx(chunk as never)}`;
    }
  });
  return rows.length;
}
