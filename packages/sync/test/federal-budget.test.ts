import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MtsLine } from '@civic/congress-client';
import { agencyRow, areaFiscalYear, areaOf, checkStatement, mtsRow, statementDates } from '../src/federal/budget.ts';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../congress-client/test/fixtures/${name}`, import.meta.url)), 'utf8'),
  );

const lines: MtsLine[] = fixture('treasury/mts9-2026-09-30.json').data;

describe('federal budget', () => {
  it('shows the awards of the newest fiscal year that ended four months ago', () => {
    expect(areaFiscalYear(new Date('2026-10-18T00:00:00Z'))).toBe(2025);
    expect(areaFiscalYear(new Date('2027-01-28T00:00:00Z'))).toBe(2025);
    expect(areaFiscalYear(new Date('2027-01-29T00:00:00Z'))).toBe(2026);
  });

  it('keeps a year’s last statement beside a new year’s', () => {
    expect(statementDates('2026-09-30')).toEqual(['2026-09-30']);
    expect(statementDates('2026-10-31')).toEqual(['2026-10-31', '2026-09-30']);
    expect(statementDates('2027-03-31')).toEqual(['2027-03-31', '2026-09-30']);
  });

  it('reads Table 9’s lines, headings without amounts', () => {
    const rows = lines.map(mtsRow);
    expect(rows.every(Boolean)).toBe(true);
    expect(rows[0]).toMatchObject({ line: 1, section: 'receipts', level: 1, kind: 'S', label: 'Receipts', fytd: null });
    expect(rows[3]).toMatchObject({ label: 'Social Insurance and Retirement Receipts', kind: 'S' });
    expect(rows[19]).toMatchObject({ section: 'outlays', label: 'Commerce and Housing Credit', fytd: -15465292145.92 });
    expect(mtsRow({ ...lines[1]!, current_fytd_rcpt_outly_amt: '$12' })).toBeNull();
    expect(() =>
      checkStatement(
        '2026-09-30',
        rows.filter((r) => r !== null),
      ),
    ).not.toThrow();
  });

  it('fails a statement whose lines don’t add up to its totals', () => {
    const rows = lines.map(mtsRow).filter((r) => r !== null);
    expect(() =>
      checkStatement(
        '2026-09-30',
        rows.filter((r) => r.label !== 'Health'),
      ),
    ).toThrow(/outlays lines add up/);
    expect(() =>
      checkStatement(
        '2026-09-30',
        rows.filter((r) => r.section === 'receipts'),
        5,
      ),
    ).toThrow(/no outlays total/);
    expect(() => checkStatement('2026-09-30', rows.slice(0, 10))).toThrow(/10 lines/);
  });

  it('names states and districts, leaving out unknown places', () => {
    const at = (shape_code: string, display_name: string) => ({
      shape_code,
      display_name,
      aggregated_amount: 1,
      population: 1,
      per_capita: 1,
    });
    expect(areaOf('state', at('MA', 'Massachusetts'))).toEqual({ area: 'MA', state: 'MA', district: null });
    expect(areaOf('state', at('', ''))).toBeNull();
    expect(areaOf('district', at('2509', 'MA-09'))).toEqual({ area: 'MA-09', state: 'MA', district: 9 });
    expect(areaOf('district', at('0200', 'AK-00'))).toEqual({ area: 'AK-00', state: 'AK', district: 0 });
    expect(areaOf('district', at('', null as unknown as string))).toBeNull();
  });

  it('keeps only safe links and slugs from the agency list', () => {
    const [treasury] = fixture('usaspending/toptier-agencies.json').results;
    expect(agencyRow(treasury)).toMatchObject({
      toptier_code: '020',
      slug: 'department-of-the-treasury',
      justification_url: 'https://www.treasury.gov/cj',
    });
    expect(
      agencyRow({ ...treasury, agency_slug: '../x', congressional_justification_url: 'javascript:alert(1)' }),
    ).toMatchObject({ slug: '', justification_url: null });
  });
});
