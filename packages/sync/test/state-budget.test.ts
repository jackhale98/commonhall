import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkShape } from '@civic/congress-client';
import { MA_BUDGET_SHAPE, maBudgetQuery, maBudgetRow } from '../src/state/budget.ts';

/** Accounts' sums as CTHRU returned them (kv7m-35wn, recorded October 2026). */
const rows = JSON.parse(
  readFileSync(new URL('../../congress-client/test/fixtures/cthru/budget-rows.json', import.meta.url), 'utf8'),
) as Record<string, unknown>[];

describe('Massachusetts budget rows', () => {
  it('match the shape the sync checks', () => {
    expect(() => checkShape('cthru', rows, MA_BUDGET_SHAPE)).not.toThrow();
  });

  it('read every recorded account and department, amounts to the cent', () => {
    const mapped = rows.map(maBudgetRow);
    expect(mapped.every((r) => r !== null)).toBe(true);
    // Chapter 70 school aid: enacted under Education, paid by the Department of Revenue.
    const chapter70 = mapped.filter((r) => r!.account === '70610008' && r!.fiscal_year === 2025);
    expect(chapter70).toEqual([
      expect.objectContaining({
        department: 'DEPARTMENT OF ELEMENTARY & SECONDARY EDUCATION',
        cabinet: 'EXECUTIVE OFFICE OF EDUCATION',
        category: 'Direct Local Aid',
        total_enacted: 6864918685,
        spent: 0,
      }),
      expect.objectContaining({
        department: 'DEPARTMENT OF REVENUE',
        total_enacted: 0,
        available: 6864918685,
        spent: 6864914827.14,
      }),
    ]);
    expect(new Set(mapped.map((r) => r!.fiscal_year))).toEqual(new Set([2025, 2026, 2027]));
  });

  it('skip rows without an eight-digit account or a year, and unreadable amounts', () => {
    expect(maBudgetRow({ fiscal_year: '2027.0', appropriation_account_number: 'TOTAL' })).toBeNull();
    expect(maBudgetRow({ appropriation_account_number: '70610008' })).toBeNull();
    expect(maBudgetRow({ fiscal_year: '2027.0', appropriation_account_number: '70610008', spent: 'n/a' })).toBeNull();
  });

  it('treat a missing sum as zero and tidy the labels', () => {
    expect(
      maBudgetRow({ fiscal_year: 2027, appropriation_account_number: '03210001', account_name: ' COMMISSION  ON X ' }),
    ).toMatchObject({ account_name: 'COMMISSION ON X', enacted: 0, spent: 0, category: '' });
  });

  it('ask the portal for each account and department’s sums from a year on', () => {
    const q = maBudgetQuery(2025);
    expect(q.$where).toBe('fiscal_year >= 2025');
    expect(q.$group).toBe('fiscal_year,appropriation_account_number,department_name');
    expect(q.$select).toContain('sum(total_expenses) as spent');
  });
});
