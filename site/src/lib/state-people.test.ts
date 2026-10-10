import { describe, expect, it } from 'vitest';
import {
  chamberLabel,
  districtLabel,
  executiveRank,
  linkHost,
  roleLabel,
  roleRank,
  seatLabel,
  sessionStatus,
  telHref,
} from './state-people';

describe('state people labels', () => {
  it('names chambers, including one-chamber legislatures', () => {
    expect(chamberLabel('MA', 'upper')).toBe('Senate');
    expect(chamberLabel('MA', 'lower')).toBe('House');
    expect(chamberLabel('MA', 'legislature')).toBe('Joint');
    expect(chamberLabel('NY', 'lower')).toBe('Assembly');
    expect(chamberLabel('VA', 'lower')).toBe('House of Delegates');
    expect(chamberLabel('NE', 'legislature')).toBe('Legislature');
    expect(chamberLabel('DC', 'legislature')).toBe('Council');
  });

  it('describes a seat', () => {
    expect(districtLabel('12')).toBe('District 12');
    expect(seatLabel({ state: 'MA', chamber: 'upper', district: 'Second Suffolk' })).toBe(
      'State Senator, Second Suffolk',
    );
    expect(seatLabel({ state: 'TX', chamber: 'lower', district: '49' })).toBe('State Representative, District 49');
    expect(seatLabel({ state: 'NY', chamber: 'lower', district: '74' })).toBe('Assembly Member, District 74');
  });

  it('puts committee leadership first', () => {
    const roles = ['member', 'ranking member', 'vice chair', 'chair', 'ex officio'];
    expect([...roles].sort((a, b) => roleRank(a) - roleRank(b))).toEqual([
      'chair',
      'vice chair',
      'ranking member',
      'ex officio',
      'member',
    ]);
    expect(roleLabel('member')).toBe('');
    expect(roleLabel('vice chair')).toBe('Vice chair');
  });

  it('makes phone and link labels', () => {
    expect(telHref('617-722-1673')).toBe('tel:6177221673');
    expect(telHref('n/a')).toBeNull();
    expect(linkHost('https://www.malegislature.gov/Legislators/Profile/L M0')).toBe('malegislature.gov');
  });
});

describe('session status', () => {
  const s = (identifier: string, start: string | null, end: string | null, classification = 'primary') => ({
    state: 'TX',
    identifier,
    name: `${identifier} Legislature`,
    classification,
    start_date: start,
    end_date: end,
  });

  it('describes the session under way', () => {
    expect(sessionStatus([s('194th', '2025-01-01', '2026-12-31')], '2026-10-10')).toBe(
      'In session: 194th Legislature, January 2025 to December 2026.',
    );
  });

  it('says when the last session ended and the next begins', () => {
    const line = sessionStatus([s('89', '2025-01-14', '2025-06-02'), s('90', '2027-01-12', null)], '2026-10-10');
    expect(line).toBe('The 89 Legislature ended in June 2025. The 90 Legislature begins in January 2027.');
  });

  it('ignores special sessions when a regular one exists', () => {
    expect(
      sessionStatus(
        [s('89', '2025-01-14', '2026-12-31'), s('891', '2026-08-01', '2026-09-01', 'special')],
        '2026-08-15',
      ),
    ).toMatch(/^In session: 89 Legislature/);
  });

  it('orders statewide offices', () => {
    const roles = ['Treasurer', 'Governor', 'Attorney General', 'Comptroller'];
    expect([...roles].sort((a, b) => executiveRank(a) - executiveRank(b))).toEqual([
      'Governor',
      'Attorney General',
      'Treasurer',
      'Comptroller',
    ]);
  });
});
