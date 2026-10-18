import { describe, expect, it } from 'vitest';
import { townOperating } from './city';
import type { TownBudget } from './state-budget';

const year = (fiscal_year: number, over: Partial<TownBudget> = {}): TownBudget => ({
  town: 'BRISTOL',
  fiscal_year,
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
  ...over,
});

describe('townOperating', () => {
  it('summarises the newest adopted budget beside the year before, with the mill rate', () => {
    const op = townOperating([
      year(2025, { total_spending: 229115085, education: 129089000, mill_rate: 31.85 }),
      year(2026),
    ])!;
    expect(op.fiscalYear).toBe(2026);
    expect(op.prevLabel).toBe('FY25');
    expect(op.total).toBe(242658950);
    expect(op.prev).toBe(229115085);
    // Revenue without the empty sources, largest first.
    expect(op.revenue.map((r) => r.label)).toEqual([
      'Property tax',
      'State of Connecticut',
      'Everything else',
      'Federal government',
    ]);
    expect(op.spending[0]).toEqual({ label: 'Education', value: 137061815, prev: 129089000 });
    expect(op.facts).toEqual([
      {
        label: 'Mill rate',
        value: '33.75',
        note: 'dollars of property tax per $1,000 of assessed value; 31.85 in FY25',
      },
    ]);
  });

  it('compares only with the year just before, and needs a budget', () => {
    const op = townOperating([year(2023), year(2026, { mill_rate: null })])!;
    expect(op.prev).toBe(0);
    expect(op.spending.every((p) => p.prev === 0)).toBe(true);
    expect(op.facts).toEqual([]);
    expect(townOperating([])).toBeNull();
  });
});
