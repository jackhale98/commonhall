import { describe, expect, it } from 'vitest';
import {
  budgetChange,
  budgetSummary,
  capitalStage,
  change311,
  closeTime,
  docketTitle,
  fundingSegments,
  streetAddress,
} from './local';

describe('311 wording', () => {
  it('words times and changes', () => {
    expect(closeTime(0.5)).toBe('under an hour');
    expect(closeTime(5)).toBe('5 hours');
    expect(closeTime(72)).toBe('3 days');
    expect(closeTime(null)).toBe('—');
    const base = { closed: 0, closedOnTime: 0, typicalHours: null, top: [] };
    expect(change311({ ...base, opened: 110, openedBefore: 100 })).toBe('+10% vs');
    expect(change311({ ...base, opened: 90, openedBefore: 100 })).toBe('−10% vs');
    expect(change311({ ...base, opened: 9, openedBefore: 0 })).toBeNull();
  });
});

describe('streetAddress', () => {
  it('drops the neighborhood and ZIP the page shows beside it', () => {
    expect(streetAddress('68 Theodore Parker RD West Roxbury 02132', 'West Roxbury')).toBe('68 Theodore Parker Rd');
    expect(streetAddress('85 Chandler ST Boston 02116', 'Boston')).toBe('85 Chandler St');
    expect(streetAddress(null, 'Boston')).toBeNull();
  });
});

describe('capital projects', () => {
  it('places the city’s statuses on the stage timeline', () => {
    expect(capitalStage('To Be Scheduled')).toBe(0);
    expect(capitalStage('Study Underway')).toBe(1);
    expect(capitalStage('In Design')).toBe(2);
    expect(capitalStage('Implementation Underway')).toBe(3);
    expect(capitalStage('Completed')).toBe(4);
    expect(capitalStage('Annual Program')).toBeNull();
  });

  it('splits the total budget in time order, with the unscheduled rest last', () => {
    const p = {
      proj_id: 'X',
      plan: 'FY27-31',
      first_year: 2027,
      department: null,
      name: 'X',
      scope: null,
      status: null,
      neighborhood: null,
      total_budget: 100,
      spent: 10,
      year0: 0,
      year1: 20,
      years_2_5: 30,
      external_funds: 0,
    };
    expect(fundingSegments(p).map((s) => [s.label, s.value])).toEqual([
      ['Spent through FY25', 10],
      ['Planned for FY27', 20],
      ['Planned for FY28–FY31', 30],
      ['Not broken down by the city', 40],
    ]);
    // Outside grants are their own part; a reduction (negative) is kept, not dropped.
    const q = {
      ...p,
      total_budget: 100_000,
      spent: 10_000,
      year0: 5_000,
      year1: 30_000,
      years_2_5: -5_000,
      external_funds: 60_000,
    };
    expect(fundingSegments(q).map((s) => [s.key, s.value])).toEqual([
      ['spent', 10_000],
      ['year0', 5_000],
      ['year1', 30_000],
      ['later', -5_000],
      ['external', 60_000],
    ]);
  });
});

describe('city budget summary', () => {
  const line = (
    kind: 'expense' | 'revenue',
    dept: string,
    grouping: string,
    year: number,
    basis: string,
    amount: number,
  ) => ({ kind, dept, grouping, line: 'x', fiscal_year: year, basis, amount }) as never;

  it('totals the newest adopted year and compares departments with the year before', () => {
    const s = budgetSummary([
      line('expense', 'Schools', 'K-8', 2027, 'budget', 100),
      line('expense', 'Schools', 'K-8', 2026, 'appropriation', 80),
      line('expense', 'Schools', 'K-8', 2025, 'actual', 70),
      line('expense', 'Police', 'Patrol', 2027, 'budget', 50),
      line('expense', 'Police', 'Patrol', 2026, 'appropriation', 50),
      line('revenue', 'Assessing', 'Property Tax', 2027, 'budget', 110),
      line('revenue', 'Collecting', 'State Aid', 2027, 'budget', 40),
    ])!;
    expect(s).toMatchObject({ year: 2027, prevYear: 2026, total: 150, prevTotal: 130, revenueTotal: 150 });
    expect(s.departments).toEqual([
      { label: 'Schools', value: 100, prev: 80 },
      { label: 'Police', value: 50, prev: 50 },
    ]);
    expect(s.revenue.map((r) => r.label)).toEqual(['Property Tax', 'State Aid']);
    expect(budgetSummary([])).toBeNull();
  });

  it('words changes', () => {
    expect(budgetChange(103.9, 100)).toBe('+3.9%');
    expect(budgetChange(99.4, 100)).toBe('−0.6%');
    expect(budgetChange(100, 100)).toBe('no change');
    expect(budgetChange(5, 0)).toBe('new');
  });
});

describe('docketTitle', () => {
  it('drops the procedural lead-in Legistar puts on hearing agendas', () => {
    expect(
      docketTitle(
        'On the message and order, referred on September 30, 2026, Docket #1829, to reduce the FY27 appropriation for the Reserve for Collective Bargaining',
      ),
    ).toBe('To reduce the FY27 appropriation for the Reserve for Collective Bargaining');
    expect(docketTitle('Councilor Weber called Docket #1311, message and order authorizing the City of Boston')).toBe(
      'Message and order authorizing the City of Boston',
    );
    expect(docketTitle('Order for a hearing to review discrepancies')).toBe(
      'Order for a hearing to review discrepancies',
    );
  });
});
