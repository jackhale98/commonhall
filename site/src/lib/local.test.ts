import { describe, expect, it } from 'vitest';
import {
  capitalStage,
  change311,
  closeTime,
  fundingSegments,
  report311,
  streetAddress,
  type Boston311Day,
} from './local';

const row = (day: string, district: number, type: string, opened: number, extra: Partial<Boston311Day> = {}) => ({
  day,
  district,
  request_type: type,
  source: 'new',
  opened,
  closed: opened,
  closed_on_time: opened,
  median_close_hours: 2,
  ...extra,
});

describe('311 report', () => {
  it('ends where both systems have data and compares with the 30 days before', () => {
    const report = report311([
      row('2026-10-08', 1, 'Litter', 10),
      { ...row('2026-10-07', 2, 'Parking', 4), source: 'legacy' },
      row('2026-09-01', 1, 'Litter', 5),
      row('2026-08-01', 1, 'Litter', 99),
    ])!;
    expect(report.to).toBe('2026-10-07');
    expect(report.from).toBe('2026-09-08');
    // The 8 October row is after the window; 1 September is in the 30 days before.
    expect(report.city.opened).toBe(4);
    expect(report.city.openedBefore).toBe(5);
    expect(report.districts[2]!.top).toEqual([{ type: 'Parking', n: 4 }]);
    expect(report311([])).toBeNull();
  });

  it('weights the typical time to close by how many closed', () => {
    const report = report311([
      row('2026-10-07', 1, 'A', 1, { median_close_hours: 100 }),
      row('2026-10-07', 1, 'B', 9, { median_close_hours: 3 }),
    ])!;
    expect(report.city.typicalHours).toBe(3);
  });

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
