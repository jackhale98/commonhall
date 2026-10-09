import { describe, expect, it } from 'vitest';
import { zbaAppealRow, zbaDate, zbaDecision } from '../src/local/zoning.ts';

describe('Zoning Board of Appeal rows', () => {
  it('puts the city decision codes in plain words', () => {
    expect(zbaDecision('AppProv')).toBe('Approved with provisos');
    expect(zbaDecision('DeniedPrej')).toBe('Denied');
    expect(zbaDecision('Withdraw')).toBe('Withdrawn');
    expect(zbaDecision('Something new')).toBe('Something new');
    expect(zbaDecision(null)).toBeNull();
  });

  it('drops placeholder dates', () => {
    expect(zbaDate('2026-10-22')).toBe('2026-10-22');
    expect(zbaDate('1753-09-23')).toBeNull();
    expect(zbaDate('')).toBeNull();
  });

  it('maps a case and never reads the applicant’s name', () => {
    const row = zbaAppealRow({
      boa_apno: 'BOA1879905',
      address: '294 Stratford ST West Roxbury 02132',
      city: 'West Roxbury',
      zip: '02132',
      ward: '20',
      status: 'Hearing Scheduled',
      appeal_type: 'Zoning',
      contact: 'A Person',
      project_description: 'Extension of the existing living space into the basement.',
      hearing_date: '2026-10-22',
      num_deferrals: '0',
    });
    expect(row).toMatchObject({ boa_apno: 'BOA1879905', neighborhood: 'West Roxbury', hearing_date: '2026-10-22' });
    expect(Object.values(row!)).not.toContain('A Person');
  });
});
