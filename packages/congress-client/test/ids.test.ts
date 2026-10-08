import { describe, expect, it } from 'vitest';
import {
  billId,
  billLabel,
  congressForDate,
  congressGovBillUrl,
  congressStartYear,
  parseBillId,
  parseVoteId,
  voteId,
} from '../src/ids.ts';
import { normalizePosition } from '../src/positions.ts';

describe('ids', () => {
  it('builds and parses bill ids', () => {
    expect(billId(119, 'HR', '1234')).toBe('119-hr-1234');
    expect(parseBillId('119-hr-1234')).toEqual({ congress: 119, type: 'hr', number: 1234 });
    expect(parseBillId('119-xx-1')).toBeNull();
    expect(parseBillId('nonsense')).toBeNull();
  });

  it('labels and links bills', () => {
    expect(billLabel('hjres', 5)).toBe('H.J.Res. 5');
    expect(congressGovBillUrl(119, 'hr', 1)).toBe('https://www.congress.gov/bill/119th-congress/house-bill/1');
    expect(congressGovBillUrl(121, 's', 2)).toBe('https://www.congress.gov/bill/121st-congress/senate-bill/2');
    expect(congressGovBillUrl(112, 'sres', 2)).toBe('https://www.congress.gov/bill/112th-congress/senate-resolution/2');
  });

  it('round-trips vote ids', () => {
    expect(voteId('senate', 119, 2, 123)).toBe('senate-119-2-123');
    expect(parseVoteId('house-119-2-80')).toEqual({ chamber: 'house', congress: 119, session: 2, rollNumber: 80 });
  });

  it('knows which Congress a date falls in', () => {
    expect(congressStartYear(119)).toBe(2025);
    expect(congressForDate(new Date('2026-10-08T00:00:00Z'))).toBe(119);
    expect(congressForDate(new Date('2027-01-02T00:00:00Z'))).toBe(119);
    expect(congressForDate(new Date('2027-01-03T12:00:00Z'))).toBe(120);
  });
});

describe('normalizePosition', () => {
  it.each([
    ['Aye', 'yea'],
    ['Yea', 'yea'],
    ['No', 'nay'],
    ['Nay', 'nay'],
    ['Guilty', 'yea'],
    ['Not Guilty', 'nay'],
    ['Present', 'present'],
    ['Not Voting', 'not_voting'],
    ['', 'not_voting'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePosition(raw)).toBe(expected);
  });
});
