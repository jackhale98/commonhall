import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkShape } from '@civic/congress-client';
import { CT_BUDGET_SHAPE, CT_TOWN_SHAPE, ctBudgetQuery, ctBudgetRow, townBudgetRow } from '../src/state/budget.ts';

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../../congress-client/test/fixtures/ct-budget/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>[];

/** Programs' sums as data.ct.gov returned them (43fc-9893, recorded October 2026), and six towns' budgets (pcg4-s5rc). */
const lines = fixture('expense-rows.json');
const towns = fixture('towns-rows.json');

describe('Connecticut budget lines', () => {
  it('match the shape the sync checks', () => {
    expect(() => checkShape('ct', lines, CT_BUDGET_SHAPE)).not.toThrow();
    expect(() => checkShape('ct towns', towns, CT_TOWN_SHAPE)).not.toThrow();
  });

  it('become one account per fund, agency and program, the agency as its group', () => {
    const mapped = lines.map(ctBudgetRow);
    expect(mapped.every((r) => r !== null)).toBe(true);
    const medicaid = mapped.find((r) => r!.fiscal_year === 2027 && r!.account_name === 'Medicaid');
    expect(medicaid).toEqual({
      state: 'CT',
      fiscal_year: 2027,
      account: 'General Fund|Department of Social Services|Medicaid',
      account_name: 'Medicaid',
      department: 'Department of Social Services',
      cabinet: 'Department of Social Services',
      category: 'Human Services',
      enacted: 3991912678.39,
      supplemental: 0,
      total_enacted: 3991912678.39,
      available: 3991912678.39,
      spent: 947711282.31,
      fund: 'General Fund',
    });
    // Accounts are unique within a year (the table's key).
    const keys = mapped.map((r) => `${r!.fiscal_year}|${r!.account}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('skip lines without a fund, agency, program or year, and unreadable amounts', () => {
    const line = { fiscal_year: '2027', fund: 'General Fund', department: 'X', program: 'Y' };
    expect(ctBudgetRow({ ...line, program: ' ' })).toBeNull();
    expect(ctBudgetRow({ ...line, fiscal_year: 'FY27' })).toBeNull();
    expect(ctBudgetRow({ ...line, spent: 'n/a' })).toBeNull();
    expect(ctBudgetRow(line)).toMatchObject({ total_enacted: 0, spent: 0, category: '' });
  });

  it('ask for the budgeted funds only, with aliases that aren’t column names', () => {
    const q = ctBudgetQuery(2025);
    expect(q.$where).toBe("fiscal_year >= 2025 AND fund_type in('General','Transportation','Other Budgeted')");
    expect(q.$select).toContain('max(service) as service_area');
    expect(q.$select).not.toMatch(/ as (service|fund_type|fund|department|program),/);
  });
});

describe('Connecticut town budgets', () => {
  it('read each town’s adopted budget, a missing amount as zero', () => {
    const rows = towns.map(townBudgetRow);
    expect(rows.every((r) => r !== null)).toBe(true);
    expect(rows.find((r) => r!.town === 'BRISTOL' && r!.fiscal_year === 2026)).toEqual({
      state: 'CT',
      town: 'BRISTOL',
      fiscal_year: 2026,
      property_tax: 187198750,
      state_revenue: 43819025,
      federal_revenue: 153365,
      fund_balance: 0,
      other_revenue: 11487810,
      total_revenue: 242658950,
      education: 137061815,
      debt_service: 13750000,
      contingency: 2000000,
      other_spending: 89847135,
      total_spending: 242658950,
      mill_rate: 33.75,
      mill_rate_vehicles: 32.46,
      tax_collection_rate: 0.9861,
      adopted_on: '2025-05-19',
    });
    // Middletown's FY2024 row leaves out federal revenue.
    expect(rows.find((r) => r!.town === 'MIDDLETOWN' && r!.fiscal_year === 2024)!.federal_revenue).toBe(0);
    expect(townBudgetRow({ fiscal_period_of_budget: '2026' })).toBeNull();
    expect(townBudgetRow({ fiscal_period_of_budget: '2026', entity_name: 'X', total_revenue: 'lots' })).toBeNull();
  });
});
