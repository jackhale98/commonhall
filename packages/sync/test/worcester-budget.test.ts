import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCapitalBudget, parseOperatingSummary, subtotalMismatches } from '../src/local/worcester-budget.ts';

// Text of the city's PDFs (pdftotext -layout), as the loader sees them.
const text = (name: string) => readFileSync(new URL(`./fixtures/worcester/${name}`, import.meta.url), 'utf8');

describe('Worcester capital budget', () => {
  const fy27 = parseCapitalBudget(text('fy27-capital-proposed.txt'));

  it('reads every project line, and each department adds up to its printed sub-total', () => {
    expect(fy27.items).toHaveLength(78);
    expect(fy27.subtotals.size).toBe(16);
    expect(subtotalMismatches(fy27)).toEqual([]);
  });

  it('keeps amounts in the right columns, including blank cells', () => {
    expect(fy27.items[0]).toMatchObject({
      department: 'Fire',
      category: 'Equipment',
      title: 'Impact Response Vehicles',
      borrowing: 360_000,
      cash: 0,
      new_authorization: 360_000,
    });
    // "Snow Equipment" prints no borrowing cell at all, only cash.
    expect(fy27.items.find((i) => i.title === 'Snow Equipment')).toMatchObject({ borrowing: 0, cash: 1_000_000 });
    expect(fy27.items.find((i) => i.title === 'Resurfacing')).toMatchObject({
      borrowing: 12_360_500,
      new_authorization: 8_700_000,
      prior_authorization: 5_000_000,
      grants: 4_500_000,
    });
  });

  it('matches descriptions to projects', () => {
    expect(fy27.items.find((i) => i.title === 'Bridges')?.description).toMatch(/Belmont Street pedestrian bridge/);
    // The city printed no description for one project.
    expect(fy27.items.filter((i) => !i.description).map((i) => i.title)).toEqual(['Salisbury Pond']);
  });

  it('reads the five-year plan by area and department', () => {
    expect(fy27.planYears).toEqual([2027, 2028, 2029, 2030, 2031]);
    expect(fy27.plan.find((r) => r.area === 'Infrastructure' && r.department === 'Parks')?.amounts).toEqual([
      12_603_000, 13_250_000, 11_500_000, 10_250_000, 7_250_000,
    ]);
    expect(fy27.planWarnings).toEqual([]);
  });

  it('reads last year’s adopted budget, reporting the city’s own arithmetic slip in its plan', () => {
    const fy26 = parseCapitalBudget(text('fy26-capital-adopted.txt'));
    expect(fy26.items).toHaveLength(82);
    expect(subtotalMismatches(fy26)).toEqual([]);
    expect(fy26.planWarnings).toEqual(['Facility Improvements 2026: rows add to 40247898, printed 41662898']);
  });
});

describe('Worcester operating budget summaries', () => {
  it('reads revenue and spending by group, every group adding up', () => {
    const fy27 = parseOperatingSummary(text('fy27-operating-proposed-summary.txt'));
    expect(fy27.problems).toEqual([]);
    expect(fy27.columns).toEqual(['FY25 Actuals', 'FY26 Budget', 'FY27 Budget']);
    const revenue = fy27.lines.filter((l) => l.kind === 'revenue');
    expect(revenue.reduce((n, l) => n + l.amounts[2]!, 0)).toBe(1_001_107_417);
    expect(revenue.find((l) => l.label === 'Hotel and Meals Tax')).toMatchObject({
      grp: 'Local Receipts',
      amounts: [5_326_896, 5_300_000, 5_400_000],
    });
    // A group printed as one line is its own group.
    expect(revenue.find((l) => l.label === 'Property Tax Levy')?.grp).toBe('Property Tax Levy');
    // A label wrapped onto two lines.
    expect(fy27.lines.find((l) => l.label === 'Charter, School Choice, & Special Education')?.grp).toBe('Education');
    expect([...new Set(fy27.lines.filter((l) => l.kind === 'spending').map((l) => l.grp))]).toEqual([
      'Fixed Costs',
      'Education',
      'City Services',
    ]);
  });

  it('finds the complete table when the book prints it in parts too (FY26)', () => {
    const fy26 = parseOperatingSummary(text('fy26-operating-adopted-summary.txt'));
    expect(fy26.problems).toEqual([]);
    expect(fy26.columns).toEqual(['FY25 Budget', 'FY26 Budget']);
    expect(fy26.lines.filter((l) => l.kind === 'spending').reduce((n, l) => n + l.amounts[1]!, 0)).toBe(947_928_261);
  });
});
