import { describe, expect, it } from 'vitest';
import type { CkanPackage } from '@civic/congress-client';
import {
  addDays,
  bostonToday,
  legacySql,
  mergeRows,
  newSystemSql,
  resources311,
  row311,
} from '../src/local/boston-311.ts';

const resource = (id: string, name: string, active = true) => ({
  id,
  name,
  format: 'CSV',
  datastore_active: active,
  last_modified: null,
});

describe('Boston 311 summaries', () => {
  it('finds the new system and the legacy table for each year in the window', () => {
    const pkg = {
      name: '311-service-requests',
      title: '311',
      metadata_modified: '',
      resources: [
        resource('new', '311 Service Requests - NEW SYSTEM'),
        resource('y26', '311 Service Requests - 2026'),
        resource('y25', '311 Service Requests - 2025'),
        resource('old', '311 SERVICE REQUESTS - 2022'),
        resource('gone', '311 Service Requests - 2026', false),
      ],
    } as CkanPackage;
    const across = resources311(pkg, '2025-12-20', '2026-01-02');
    expect(across.current?.id).toBe('new');
    expect([...across.legacy.values()].map((r) => r.id)).toEqual(['y25', 'y26']);
    expect([...resources311(pkg, '2026-09-01', '2026-09-14').legacy.keys()]).toEqual([2026]);
  });

  it('maps a summary row and folds unknown districts to 0', () => {
    expect(
      row311(
        {
          day: '2026-10-08T00:00:00',
          district: ' 7',
          request_type: 'Rodent Activity',
          opened: '12',
          closed: 9,
          closed_on_time: 8,
          median_close_hours: 4.78029,
        },
        'new',
      ),
    ).toEqual({
      day: '2026-10-08',
      district: 7,
      request_type: 'Rodent Activity',
      source: 'new',
      opened: 12,
      closed: 9,
      closed_on_time: 8,
      median_close_hours: 4.78,
    });
    expect(row311({ day: '2026-10-08', district: '0', request_type: 'X', opened: 1 }, 'legacy')?.district).toBe(0);
    expect(row311({ day: '2026-10-08', district: null, request_type: 'X', opened: 1 }, 'legacy')?.district).toBe(0);
    expect(row311({ day: '2026-10-08', district: '3', request_type: '', opened: 1 }, 'legacy')).toBeNull();
  });

  it('adds together rows that share a key once districts are folded', () => {
    const base = { day: '2026-10-08', request_type: 'X', source: 'new' as const, closed_on_time: 0 };
    const merged = mergeRows([
      { ...base, district: 0, opened: 2, closed: 1, median_close_hours: 10 },
      { ...base, district: 0, opened: 3, closed: 3, median_close_hours: 2 },
    ]);
    expect(merged).toEqual([{ ...base, district: 0, opened: 5, closed: 4, median_close_hours: 2 }]);
  });

  it('writes SQL the portal accepts (no substr or extract) for Boston days', () => {
    for (const q of [newSystemSql('abc', '2026-10-01', '2026-10-07'), legacySql('def', '2026-10-01', '2026-10-07')]) {
      expect(q).not.toMatch(/\bsubstr\b|\bextract\b|\bfilter\b/i);
      expect(q).toMatch(/percentile_cont/);
    }
    expect(newSystemSql('abc', '2026-10-01', '2026-10-07')).toContain("at time zone 'America/New_York'");
    expect(legacySql('def', '2026-10-01', '2026-10-07')).toContain("open_dt < '2026-10-08'");
  });

  it('counts days in Boston time', () => {
    expect(bostonToday(new Date('2026-10-09T03:00:00Z'))).toBe('2026-10-08');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
