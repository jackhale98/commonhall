import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  agencyHref,
  districtSpending,
  statement,
  statementMonth,
  statementYear,
  statements,
  type AreaSpending,
  type MtsLineRow,
} from './federal-budget';

/** The September 2026 statement's Table 9 (recorded), as federal_mts_lines holds it. */
const raw = JSON.parse(
  readFileSync(
    new URL('../../../packages/congress-client/test/fixtures/treasury/mts9-2026-09-30.json', import.meta.url),
    'utf8',
  ),
).data as Record<string, string>[];
const amount = (v: string) => (v === 'null' ? null : Number(v));
const lines: MtsLineRow[] = raw.map((l) => ({
  record_date: l.record_date!,
  line: Number(l.src_line_nbr),
  section: l.sequence_number_cd!.startsWith('1') ? 'receipts' : 'outlays',
  level: Number(l.sequence_level_nbr),
  kind: l.data_type_cd as MtsLineRow['kind'],
  label: l.classification_desc!.replace(/:$/, ''),
  month: amount(l.current_month_rcpt_outly_amt!),
  fytd: amount(l.current_fytd_rcpt_outly_amt!),
  prior_fytd: amount(l.prior_fytd_rcpt_outly_amt!),
}));

describe('statement', () => {
  it('adds up the year: receipts, outlays and the deficit, with the year before', () => {
    const s = statement('2026-09-30', lines)!;
    expect(s.fiscalYear).toBe(2026);
    expect(s.months).toBe(12);
    expect(s.receipts).toBeCloseTo(5403326758960.81, 2);
    expect(s.outlays).toBeCloseTo(7395799983313.23, 2);
    expect(s.deficit).toBeCloseTo(1992473224352.42, 2);
    expect(s.prior.deficit).toBeCloseTo(1775369189818.35, 2);
  });

  it('lists sources with a heading’s lines added together, and outlays without the negative lines', () => {
    const s = statement('2026-09-30', lines)!;
    expect(s.sources[0]!.label).toBe('Individual Income Taxes');
    const social = s.sources.find((i) => i.label === 'Social Insurance and Retirement Receipts')!;
    expect(social.value).toBeCloseTo(1754273234159.58 + 49090010812.43 + 8431476188.91, 2);
    expect(s.sources.reduce((n, i) => n + i.value, 0)).toBeCloseTo(s.receipts, 0);
    expect(s.functions[0]!.label).toBe('Social Security');
    expect(s.negatives.map((i) => i.label)).toEqual([
      'Commerce and Housing Credit',
      'Undistributed Offsetting Receipts',
    ]);
    const all = [...s.functions, ...s.negatives].reduce((n, i) => n + i.value, 0);
    expect(all).toBeCloseTo(s.outlays, 0);
  });

  it('holds statements newest first and names their months', () => {
    const october = lines.map((l) => ({ ...l, record_date: '2026-10-31' }));
    expect(statements([...lines, ...october]).map((s) => [s.date, s.fiscalYear, s.months])).toEqual([
      ['2026-10-31', 2027, 1],
      ['2026-09-30', 2026, 12],
    ]);
    expect(statementYear('2027-03-31')).toEqual({ fiscalYear: 2027, months: 6 });
    expect(statementMonth('2026-09-30')).toBe('September 2026');
    expect(statement('2026-08-31', lines)).toBeNull();
  });
});

describe('agencies and districts', () => {
  it('links an agency to USAspending only by a plain slug', () => {
    expect(agencyHref('department-of-the-treasury')).toBe(
      'https://www.usaspending.gov/agency/department-of-the-treasury',
    );
    expect(agencyHref('../x')).toBeNull();
    expect(agencyHref('')).toBeNull();
  });

  it('finds saved districts’ row, and a one-seat state’s only row', () => {
    const row = (area: string, state: string, district: number | null): AreaSpending => ({
      area,
      fiscal_year: 2025,
      state,
      district,
      contracts: 1,
      grants: 1,
      other: 1,
      population: 1,
    });
    const rows = [row('MA', 'MA', null), row('MA-08', 'MA', 8), row('MA-09', 'MA', 9), row('AK-00', 'AK', 0)];
    expect(districtSpending(rows, 'MA', 8)!.area).toBe('MA-08');
    expect(districtSpending(rows, 'MA', null)).toBeNull();
    expect(districtSpending(rows, 'AK', 1)!.area).toBe('AK-00');
    expect(districtSpending(rows, 'CT', 1)).toBeNull();
  });
});
