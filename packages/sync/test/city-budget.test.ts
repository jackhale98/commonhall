import { describe, expect, it } from 'vitest';
import { budgetAmount, budgetColumn, cityBudgetRows } from '../src/local/city-budget.ts';

describe('city budget', () => {
  it('reads the year and basis from the column name', () => {
    expect(budgetColumn('FY27 Budget')).toEqual({ fiscalYear: 2027, basis: 'budget' });
    expect(budgetColumn('FY26 Appropriation')).toEqual({ fiscalYear: 2026, basis: 'appropriation' });
    expect(budgetColumn('FY24 Actual Expense')).toEqual({ fiscalYear: 2024, basis: 'actual' });
    expect(budgetColumn('FY25 Actual')).toEqual({ fiscalYear: 2025, basis: 'actual' });
    expect(budgetColumn('Dept')).toBeNull();
  });

  it('leaves "#Missing" out instead of counting it as zero', () => {
    expect(budgetAmount('2137030.05')).toBe(2137030.05);
    expect(budgetAmount(14780000)).toBe(14780000);
    expect(budgetAmount('0')).toBe(0);
    expect(budgetAmount('#Missing')).toBeNull();
    expect(budgetAmount('')).toBeNull();
  });

  it('maps an expense line to one row per year with an amount', () => {
    const rows = cityBudgetRows('expense', {
      _id: 1,
      Cabinet: "Mayor's Cabinet",
      Dept: "Mayor's Office",
      Program: "Mayor's Administration",
      'Expense Category': 'Personnel Services',
      'FY24 Actual Expense': '#Missing',
      'FY25 Actual Expense': '2186375.73',
      'FY26 Appropriation': '1956659.52',
      'FY27 Budget': '2137030.05',
    });
    expect(rows.map((r) => [r.fiscal_year, r.basis, r.amount])).toEqual([
      [2025, 'actual', 2186375.73],
      [2026, 'appropriation', 1956659.52],
      [2027, 'budget', 2137030.05],
    ]);
    expect(rows[0]).toMatchObject({ grouping: "Mayor's Administration", line: 'Personnel Services' });
  });

  it('skips the grand-total row so the budget is not counted twice', () => {
    const total = {
      _id: 918,
      Cabinet: '',
      Dept: '',
      Program: '',
      'Expense Category': '',
      'FY27 Budget': '4942387983.36',
    };
    expect(cityBudgetRows('expense', total)).toEqual([]);
    expect(cityBudgetRows('revenue', { 'Revenue Category': 'Total', Account: '', 'FY27 Budget': 1 })).toEqual([]);
  });

  it('maps a revenue account', () => {
    const [row] = cityBudgetRows('revenue', {
      'Revenue Category': 'Property Tax',
      Account: 'Real Estate Tax',
      Cabinet: 'Finance',
      Dept: 'Collecting Division',
      'FY27 Budget': 3600000000,
    });
    expect(row).toMatchObject({
      grouping: 'Property Tax',
      line: 'Real Estate Tax',
      fiscal_year: 2027,
      amount: 3600000000,
    });
  });
});
