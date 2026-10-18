/**
 * Federal spending for the Budget page and the home page: the Monthly Treasury
 * Statement's receipts and outlays (federal_mts_lines), each agency's budget
 * (federal_agency_budgets), and awards by state and district (federal_area_spending).
 * The amounts are the sources' own; nothing is estimated.
 */
import { safeUrl } from '@civic/congress-client/safe-url';

export interface MtsLineRow {
  record_date: string;
  line: number;
  section: 'receipts' | 'outlays';
  level: number;
  kind: 'S' | 'D' | 'T';
  label: string;
  month: number | null;
  fytd: number | null;
  prior_fytd: number | null;
}

export interface StatementItem {
  label: string;
  /** The fiscal year to date. */
  value: number;
  /** The year before, to the same month. */
  prev: number;
}

export interface Statement {
  /** The statement's date, the last day of its month. */
  date: string;
  fiscalYear: number;
  /** Months of the fiscal year it covers: 1 for October, 12 for September (the whole year). */
  months: number;
  receipts: number;
  outlays: number;
  /** Outlays less receipts: positive is a deficit. */
  deficit: number;
  prior: { receipts: number; outlays: number; deficit: number };
  /** Receipts by source, largest first. */
  sources: StatementItem[];
  /** Outlays by budget function, largest first, without the negative lines. */
  functions: StatementItem[];
  /** Lines that reduce outlays (offsetting receipts, credit programs' repayments). */
  negatives: StatementItem[];
}

const num = (v: number | string | null) => Number(v ?? 0);

/** The federal fiscal year a statement date falls in, and how many of its months it covers. */
export function statementYear(date: string): { fiscalYear: number; months: number } {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return { fiscalYear: m >= 10 ? y + 1 : y, months: ((m + 2) % 12) + 1 };
}

/** One statement's lines as totals and the items under them. */
export function statement(date: string, lines: MtsLineRow[]): Statement | null {
  const mine = lines.filter((l) => l.record_date === date).sort((a, b) => a.line - b.line);
  const total = (section: MtsLineRow['section']) => mine.find((l) => l.section === section && l.kind === 'T');
  const r = total('receipts');
  const o = total('outlays');
  if (!r || !o || r.fytd === null || o.fytd === null) return null;
  const items = (section: MtsLineRow['section']) => {
    const out: StatementItem[] = [];
    let group: StatementItem | null = null;
    for (const l of mine.filter((x) => x.section === section && x.level >= 2)) {
      if (l.kind === 'S' && l.level === 2) {
        // A heading's lines are added up under it ("Social Insurance and Retirement Receipts").
        group = { label: l.label, value: 0, prev: 0 };
        out.push(group);
      } else if (l.kind === 'D' && l.level === 2) {
        group = null;
        out.push({ label: l.label, value: num(l.fytd), prev: num(l.prior_fytd) });
      } else if (l.kind === 'D' && group) {
        group.value += num(l.fytd);
        group.prev += num(l.prior_fytd);
      }
    }
    return out.sort((a, b) => b.value - a.value);
  };
  const outlays = items('outlays');
  const receipts = num(r.fytd);
  const spent = num(o.fytd);
  return {
    date,
    ...statementYear(date),
    receipts,
    outlays: spent,
    deficit: spent - receipts,
    prior: { receipts: num(r.prior_fytd), outlays: num(o.prior_fytd), deficit: num(o.prior_fytd) - num(r.prior_fytd) },
    sources: items('receipts').filter((i) => i.value > 0),
    functions: outlays.filter((i) => i.value > 0),
    negatives: outlays.filter((i) => i.value < 0),
  };
}

/** Each statement held, newest first. */
export function statements(lines: MtsLineRow[]): Statement[] {
  const dates = [...new Set(lines.map((l) => l.record_date))].sort().reverse();
  return dates.map((d) => statement(d, lines)).filter((s): s is Statement => s !== null);
}

/** "September 2026" for a statement date. */
export function statementMonth(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface AgencyBudget {
  toptier_code: string;
  name: string;
  abbreviation: string;
  slug: string;
  fiscal_year: number;
  fiscal_quarter: number;
  budget_authority: number;
  obligated: number;
  outlays: number;
  share: number;
  justification_url: string | null;
}

/** The agency's page on USAspending, from its slug. */
export function agencyHref(slug: string): string | null {
  return /^[a-z0-9-]+$/.test(slug) ? safeUrl(`https://www.usaspending.gov/agency/${slug}`) : null;
}

export interface AreaSpending {
  area: string;
  fiscal_year: number;
  state: string;
  district: number | null;
  contracts: number;
  grants: number;
  other: number;
  population: number | null;
}

/** Columns the site reads from federal_area_spending. */
export const AREA_COLUMNS = 'area,fiscal_year,state,district,contracts,grants,other,population';

/** "MA-08" for a state and district number, as USAspending names districts ("AK-00" at large). */
export const districtArea = (state: string, district: number) => `${state}-${String(district).padStart(2, '0')}`;

/**
 * A district's row for saved districts: by its number, or for a state with one seat
 * the only row it has (Census and Congress.gov number at-large seats differently).
 */
export function districtSpending(rows: AreaSpending[], state: string, district: number | null): AreaSpending | null {
  const mine = rows.filter((r) => r.state === state && r.district !== null);
  if (mine.length === 1) return mine[0]!;
  return district === null ? null : (mine.find((r) => r.district === district) ?? null);
}

/** Dollars per person, or null without a population. */
export const perPerson = (amount: number, population: number | null) =>
  population && population > 0 ? amount / population : null;
