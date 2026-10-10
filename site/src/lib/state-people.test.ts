import { describe, expect, it } from 'vitest';
import { chamberLabel, districtLabel, linkHost, roleLabel, roleRank, seatLabel, telHref } from './state-people';

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
