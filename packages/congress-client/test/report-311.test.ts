import { describe, expect, it } from 'vitest';
import { report311, type Day311 } from '../src/report-311.ts';

const row = (day: string, district: number, type: string, opened: number, extra: Partial<Day311> = {}) => ({
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
    const report = report311(
      [
        row('2026-10-08', 1, 'Litter', 10),
        { ...row('2026-10-07', 2, 'Parking', 4), source: 'legacy' },
        row('2026-09-01', 1, 'Litter', 5),
        row('2026-08-01', 1, 'Litter', 99),
      ],
      { districts: 9 },
    )!;
    expect(report.to).toBe('2026-10-07');
    expect(report.from).toBe('2026-09-08');
    // The 8 October row is after the window; 1 September is in the 30 days before.
    expect(report.city.opened).toBe(4);
    expect(report.city.openedBefore).toBe(5);
    expect(report.districts[2]!.top).toEqual([{ type: 'Parking', n: 4 }]);
    expect(report311([], { districts: 9 })).toBeNull();
  });

  it('weights the typical time to close by how many closed', () => {
    const report = report311(
      [
        row('2026-10-07', 1, 'A', 1, { median_close_hours: 100 }),
        row('2026-10-07', 1, 'B', 9, { median_close_hours: 3 }),
      ],
      { districts: 9 },
    )!;
    expect(report.city.typicalHours).toBe(3);
  });
});
